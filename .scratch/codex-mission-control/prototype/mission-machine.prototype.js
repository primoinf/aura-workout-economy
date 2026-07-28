// THROWAWAY PROTOTYPE
// Question: can one explicit state model support correction loops, human-gated
// release, blocking/resume, and bounded playbook promotion without gate bypasses?

const TERMINAL = new Set(["COMPLETED", "CANCELLED"]);

export function createMission(options = {}) {
  return {
    status: "DRAFT",
    blockedFrom: null,
    contextVersion: 0,
    releaseRequired: options.releaseRequired ?? true,
    releaseAuthorized: options.releaseAuthorized ?? true,
    evidence: {
      artifacts: false,
      review: null,
      validation: null,
      humanApproval: null,
    },
    changeReason: null,
    playbook: {
      status: "NONE",
      baselineScore: null,
      candidateScore: null,
      criticalRegression: null,
    },
    history: [],
  };
}

function requireStatus(state, action, ...allowed) {
  if (!allowed.includes(state.status)) {
    throw new Error(
      `${action} is illegal from ${state.status}; expected ${allowed.join(" or ")}`,
    );
  }
}

function clearDownstreamEvidence(state) {
  return {
    ...state.evidence,
    artifacts: false,
    review: null,
    validation: null,
    humanApproval: null,
  };
}

function record(previous, next, action, reason) {
  const event = {
    sequence: previous.history.length + 1,
    type: action,
    from: previous.status,
    to: next.status,
    reason: reason ?? null,
    contextVersion: next.contextVersion,
  };

  return {
    ...next,
    history: [...previous.history, event],
  };
}

export function transition(state, command) {
  if (TERMINAL.has(state.status)) {
    throw new Error(`${state.status} is terminal`);
  }

  const action = command.type;
  const reason = command.reason;
  let next;

  switch (action) {
    case "PREPARE_CONTEXT":
      requireStatus(state, action, "DRAFT");
      next = {
        ...state,
        status: "CONTEXT_READY",
        contextVersion: 1,
      };
      break;

    case "REVISE_CONTEXT":
      requireStatus(
        state,
        action,
        "CONTEXT_READY",
        "PLANNED",
        "RUNNING",
        "REVIEWING",
        "CHANGES_REQUESTED",
        "VALIDATING",
        "APPROVAL_REQUIRED",
      );
      next = {
        ...state,
        status: "CONTEXT_READY",
        contextVersion: state.contextVersion + 1,
        evidence: clearDownstreamEvidence(state),
        changeReason: "Context changed; downstream evidence invalidated",
      };
      break;

    case "PLAN":
      requireStatus(state, action, "CONTEXT_READY");
      next = { ...state, status: "PLANNED", changeReason: null };
      break;

    case "START_RUN":
      requireStatus(state, action, "PLANNED", "CHANGES_REQUESTED");
      next = {
        ...state,
        status: "RUNNING",
        evidence: clearDownstreamEvidence(state),
        changeReason: null,
      };
      break;

    case "SUBMIT_ARTIFACTS":
      requireStatus(state, action, "RUNNING");
      next = {
        ...state,
        status: "REVIEWING",
        evidence: { ...state.evidence, artifacts: true },
      };
      break;

    case "REVIEW_PASS":
      requireStatus(state, action, "REVIEWING");
      if (!state.evidence.artifacts) {
        throw new Error("review requires current artifacts");
      }
      next = {
        ...state,
        status: "VALIDATING",
        evidence: { ...state.evidence, review: "PASS" },
      };
      break;

    case "REVIEW_FAIL":
      requireStatus(state, action, "REVIEWING");
      next = {
        ...state,
        status: "CHANGES_REQUESTED",
        evidence: {
          ...state.evidence,
          review: "FAIL",
          validation: null,
          humanApproval: null,
        },
        changeReason: reason ?? "Review requested changes",
      };
      break;

    case "VALIDATION_PASS":
      requireStatus(state, action, "VALIDATING");
      if (state.evidence.review !== "PASS") {
        throw new Error("validation requires a current passing review");
      }
      next = {
        ...state,
        status: "APPROVAL_REQUIRED",
        evidence: { ...state.evidence, validation: "PASS" },
      };
      break;

    case "VALIDATION_FAIL":
      requireStatus(state, action, "VALIDATING");
      next = {
        ...state,
        status: "CHANGES_REQUESTED",
        evidence: {
          ...state.evidence,
          validation: "FAIL",
          humanApproval: null,
        },
        changeReason: reason ?? "Validation failed",
      };
      break;

    case "HUMAN_APPROVE":
      requireStatus(state, action, "APPROVAL_REQUIRED");
      if (
        state.evidence.review !== "PASS" ||
        state.evidence.validation !== "PASS"
      ) {
        throw new Error("approval requires current passing review and validation");
      }
      if (state.releaseRequired && !state.releaseAuthorized) {
        throw new Error("the Brief does not authorize the required release");
      }
      next = {
        ...state,
        status: state.releaseRequired ? "READY_TO_RELEASE" : "LEARNING",
        evidence: { ...state.evidence, humanApproval: "APPROVED" },
      };
      break;

    case "HUMAN_REJECT":
      requireStatus(state, action, "APPROVAL_REQUIRED");
      next = {
        ...state,
        status: "CHANGES_REQUESTED",
        evidence: { ...state.evidence, humanApproval: "REJECTED" },
        changeReason: reason ?? "Human rejected the release candidate",
      };
      break;

    case "RELEASE":
      requireStatus(state, action, "READY_TO_RELEASE");
      if (!state.releaseRequired || !state.releaseAuthorized) {
        throw new Error("release is not authorized by this Mission");
      }
      if (state.evidence.humanApproval !== "APPROVED") {
        throw new Error("release requires explicit human approval");
      }
      next = { ...state, status: "RELEASED" };
      break;

    case "BEGIN_LEARNING":
      requireStatus(state, action, "RELEASED");
      next = { ...state, status: "LEARNING" };
      break;

    case "PROPOSE_PLAYBOOK":
      requireStatus(state, action, "LEARNING");
      if (state.playbook.status !== "NONE") {
        throw new Error("a playbook candidate already exists");
      }
      next = {
        ...state,
        playbook: { ...state.playbook, status: "PROPOSED" },
      };
      break;

    case "EVALUATE_PLAYBOOK":
      requireStatus(state, action, "LEARNING");
      if (state.playbook.status !== "PROPOSED") {
        throw new Error("only a proposed playbook can be evaluated");
      }
      next = {
        ...state,
        playbook: {
          status: "EVALUATING",
          baselineScore: command.baselineScore,
          candidateScore: command.candidateScore,
          criticalRegression: command.criticalRegression ?? false,
        },
      };
      break;

    case "REQUEST_PLAYBOOK_APPROVAL":
      requireStatus(state, action, "LEARNING");
      if (state.playbook.status !== "EVALUATING") {
        throw new Error("the candidate must be evaluated first");
      }
      if (state.playbook.criticalRegression) {
        throw new Error("a candidate with a critical regression cannot advance");
      }
      if (state.playbook.candidateScore <= state.playbook.baselineScore) {
        throw new Error("the candidate must outperform the baseline");
      }
      next = {
        ...state,
        playbook: { ...state.playbook, status: "APPROVAL_REQUIRED" },
      };
      break;

    case "APPROVE_PLAYBOOK":
      requireStatus(state, action, "LEARNING");
      if (state.playbook.status !== "APPROVAL_REQUIRED") {
        throw new Error("playbook promotion requires human approval");
      }
      next = {
        ...state,
        playbook: { ...state.playbook, status: "PROMOTED" },
      };
      break;

    case "REJECT_PLAYBOOK":
      requireStatus(state, action, "LEARNING");
      if (!["EVALUATING", "APPROVAL_REQUIRED"].includes(state.playbook.status)) {
        throw new Error("only an evaluated candidate can be rejected");
      }
      next = {
        ...state,
        playbook: { ...state.playbook, status: "REJECTED" },
      };
      break;

    case "COMPLETE":
      requireStatus(state, action, "LEARNING");
      if (
        !["NONE", "PROMOTED", "REJECTED"].includes(state.playbook.status)
      ) {
        throw new Error("resolve the playbook candidate before completion");
      }
      next = { ...state, status: "COMPLETED" };
      break;

    case "BLOCK":
      if (state.status === "BLOCKED") {
        throw new Error("Mission is already blocked");
      }
      next = {
        ...state,
        status: "BLOCKED",
        blockedFrom: state.status,
        changeReason: reason ?? "Blocked",
      };
      break;

    case "RESUME":
      requireStatus(state, action, "BLOCKED");
      if (!state.blockedFrom) {
        throw new Error("blocked Mission has no safe resume state");
      }
      next = {
        ...state,
        status: state.blockedFrom,
        blockedFrom: null,
        changeReason: null,
      };
      break;

    case "CANCEL":
      next = { ...state, status: "CANCELLED" };
      break;

    default:
      throw new Error(`unknown action: ${action}`);
  }

  return record(state, next, action, reason);
}

export function runCommands(initialState, commands) {
  return commands.reduce((state, command) => transition(state, command), initialState);
}
