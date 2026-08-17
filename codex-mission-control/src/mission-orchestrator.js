import {
  assertValidAgentAssignment,
  canonicalOwnershipPath,
} from "./agent-assignment.js";
import { routeAgentAssignment } from "./agent-routing-adapter.js";
import {
  artifactHasInspectableDetail,
  artifactReference,
} from "./artifact-inspection.js";
import {
  applyTaskReviewFindings,
  createTaskExecution,
  interruptTaskExecution,
  planTaskExecutionWave,
  projectTaskExecutionEvent,
  resumeInterruptedTaskExecution,
  taskExecutionAllowedActions,
  writableAssignmentsOverlap,
} from "./task-graph-execution.js";

const REQUIRED_BRIEF_FIELDS = [
  "goal",
  "scope",
  "acceptanceCriteria",
  "constraints",
  "risk",
  "mutationAuthority",
  "releaseRequired",
  "releaseAuthority",
];

const GLOBAL_AGENT_CAPACITY = 4;
const EVENT_SCHEMA_VERSION = 2;

export const MISSION_STATUS_ORDER = Object.freeze([
  "BRIEF_ACCEPTED",
  "CONTEXT_READY",
  "PLANNED",
  "RUNNING",
  "IN_REVIEW",
  "VALIDATING",
  "APPROVAL_REQUIRED",
  "READY_TO_RELEASE",
  "LEARNING",
  "READY_TO_COMPLETE",
  "COMPLETED",
]);

const COMMANDS = {
  CAPTURE_CONTEXT: {
    action: "capture_context",
    from: "BRIEF_ACCEPTED",
    to: "CONTEXT_READY",
    eventType: "CONTEXT_CAPTURED",
    field: "context",
  },
  ACCEPT_PLAN: {
    action: "accept_plan",
    from: "CONTEXT_READY",
    to: "PLANNED",
    eventType: "PLAN_ACCEPTED",
    field: "plan",
  },
  START_RUN: {
    action: "start_run",
    from: "PLANNED",
    to: "RUNNING",
    eventType: "RUN_STARTED",
    field: "run",
  },
  SUBMIT_ARTIFACT: {
    action: "submit_artifact",
    from: "RUNNING",
    to: "IN_REVIEW",
    eventType: "ARTIFACT_SUBMITTED",
    field: "artifact",
    requiresEvidence: true,
  },
  PASS_REVIEW: {
    action: "pass_review",
    from: "IN_REVIEW",
    to: "VALIDATING",
    eventType: "REVIEW_PASSED",
    field: "review",
    requiresEvidence: true,
  },
  PASS_VALIDATION: {
    action: "pass_validation",
    from: "VALIDATING",
    to: "LEARNING",
    eventType: "VALIDATION_PASSED",
    field: "validation",
    requiresEvidence: true,
  },
  APPROVE_RELEASE: {
    action: "approve_release",
    from: "APPROVAL_REQUIRED",
    to: "READY_TO_RELEASE",
    eventType: "RELEASE_APPROVED",
    field: "approval",
    requiresEvidence: true,
  },
  CAPTURE_LEARNING: {
    action: "capture_learning",
    from: "LEARNING",
    to: "READY_TO_COMPLETE",
    eventType: "LEARNING_CAPTURED",
    field: "learning",
    requiresEvidence: true,
  },
  COMPLETE_NO_RELEASE: {
    action: "complete_no_release",
    from: "READY_TO_COMPLETE",
    to: "COMPLETED",
    eventType: "MISSION_COMPLETED",
    field: "completion",
    requiresEvidence: true,
  },
};

const CORRECTION_COMMANDS = {
  REJECT_REVIEW: {
    action: "reject_review",
    from: "IN_REVIEW",
    eventType: "REVIEW_REJECTED",
    field: "review",
    requiresEvidence: true,
  },
  FAIL_VALIDATION: {
    action: "fail_validation",
    from: "VALIDATING",
    eventType: "VALIDATION_FAILED",
    field: "validation",
    requiresEvidence: true,
  },
  REJECT_RELEASE: {
    action: "reject_release",
    from: "APPROVAL_REQUIRED",
    eventType: "RELEASE_REJECTED",
    field: "approval",
    requiresEvidence: true,
  },
  START_CORRECTION: {
    action: "start_correction",
    from: ["CHANGES_REQUESTED", "RUNNING"],
    eventType: "CORRECTION_STARTED",
    field: "run",
  },
  REVISE_CONTEXT: {
    action: "revise_context",
    from: [
      "CONTEXT_READY",
      "PLANNED",
      "RUNNING",
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "VALIDATING",
      "APPROVAL_REQUIRED",
      "READY_TO_RELEASE",
      "LEARNING",
      "READY_TO_COMPLETE",
    ],
    eventType: "CONTEXT_REVISED",
    field: "context",
  },
  BLOCK_MISSION: {
    action: "block_mission",
    from: [
      "BRIEF_ACCEPTED",
      "CONTEXT_READY",
      "PLANNED",
      "RUNNING",
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "VALIDATING",
      "APPROVAL_REQUIRED",
      "READY_TO_RELEASE",
      "LEARNING",
      "READY_TO_COMPLETE",
    ],
    eventType: "MISSION_BLOCKED",
    field: "block",
  },
  RESUME_MISSION: {
    action: "resume_mission",
    from: "BLOCKED",
    eventType: "MISSION_RESUMED",
    field: "resumption",
  },
  CANCEL_MISSION: {
    action: "cancel_mission",
    from: [
      "BRIEF_ACCEPTED",
      "CONTEXT_READY",
      "PLANNED",
      "RUNNING",
      "IN_REVIEW",
      "CHANGES_REQUESTED",
      "VALIDATING",
      "APPROVAL_REQUIRED",
      "READY_TO_RELEASE",
      "LEARNING",
      "READY_TO_COMPLETE",
      "BLOCKED",
    ],
    eventType: "MISSION_CANCELLED",
    field: "cancellation",
  },
};

const EXECUTION_COMMANDS = {
  OPEN_DECISION_ROOM: {
    action: "open_decision_room",
    from: ["PLANNED", "RUNNING", "CHANGES_REQUESTED"],
    eventType: "DECISION_ROOM_OPENED",
    field: "decisionRoom",
    requiresEvidence: true,
  },
  RESOLVE_DECISION_ROOM: {
    action: "resolve_decision_room",
    from: ["PLANNED", "RUNNING", "CHANGES_REQUESTED"],
    eventType: "DECISION_ROOM_RESOLVED",
    field: "decision",
  },
  RETRY_EXECUTION_ASSIGNMENT: {
    action: "retry_execution_assignment",
    from: ["RUNNING", "CHANGES_REQUESTED"],
    eventType: "EXECUTION_ASSIGNMENT_RETRIED",
    field: "retry",
  },
  RECOVER_EXECUTION_TRANSPORT: {
    action: "recover_execution_transport",
    from: ["BLOCKED", "CANCELLED"],
    eventType: "EXECUTION_TRANSPORT_RECOVERED",
    field: "recovery",
  },
};

const CHANGES_REQUESTED_ACTIONS = Object.freeze([
  "start_correction",
  "revise_context",
  "block_mission",
  "cancel_mission",
]);

const COMMAND_BY_STATUS = Object.fromEntries(
  Object.values(COMMANDS).map((command) => [command.from, command]),
);

function allowedActionsForMission(mission) {
  if (mission.status === "CANCELLED") {
    return getOpenExecutionTransportReservations(mission).length > 0
      ? ["recover_execution_transport"]
      : [];
  }
  if (mission.status === "COMPLETED") {
    return [];
  }
  if (mission.status === "BLOCKED") {
    return getOpenExecutionTransportReservations(mission).length > 0
      ? [
          "recover_execution_transport",
          "resume_mission",
          "cancel_mission",
        ]
      : ["resume_mission", "cancel_mission"];
  }
  if (
    mission.execution &&
    ["PLANNED", "RUNNING", "CHANGES_REQUESTED"].includes(mission.status)
  ) {
    return appendUniqueStrings(
      taskExecutionAllowedActions(mission.execution),
      "revise_context",
      "block_mission",
      "cancel_mission",
    );
  }
  if (mission.status === "CHANGES_REQUESTED") {
    return [...CHANGES_REQUESTED_ACTIONS];
  }
  if (mission.status === "APPROVAL_REQUIRED") {
    return [
      "approve_release",
      "reject_release",
      "revise_context",
      "block_mission",
      "cancel_mission",
    ];
  }
  if (mission.status === "READY_TO_RELEASE") {
    return ["revise_context", "block_mission", "cancel_mission"];
  }
  if (mission.status === "IN_REVIEW" && mission.execution) {
    const reviewerOutcome = mission.execution.nodes.find(
      (node) => node.assignment.workKind === "review",
    )?.reviewOutcome?.outcome;
    return appendUniqueStrings(
      reviewerOutcome === "PASSED" ? ["pass_review"] : [],
      reviewerOutcome === "CHANGES_REQUESTED" ? ["reject_review"] : [],
      "revise_context",
      "block_mission",
      "cancel_mission",
    );
  }
  const actions = [];
  const primary = COMMAND_BY_STATUS[mission.status]?.action;
  const hasInterruptedAssignedRun =
    Boolean(mission.assignment) &&
    mission.status === "RUNNING" &&
    ["INTERRUPTED", "BLOCKED", "ERROR"].includes(mission.run?.status) &&
    !mission.correctionActive;
  const hasActiveAgentRun =
    Boolean(mission.assignment) &&
    mission.status === "RUNNING" &&
    !hasInterruptedAssignedRun &&
    !mission.correctionActive;
  const hasRoutedAssignment =
    Boolean(mission.assignment) && mission.status === "PLANNED";
  if (hasInterruptedAssignedRun) {
    actions.push("start_correction");
  } else if (primary && !hasActiveAgentRun && !hasRoutedAssignment) {
    actions.push(primary);
  }
  if (mission.status === "IN_REVIEW") {
    actions.push("reject_review");
  }
  if (mission.status === "VALIDATING") {
    actions.push("fail_validation");
  }
  if (CORRECTION_COMMANDS.REVISE_CONTEXT.from.includes(mission.status)) {
    actions.push("revise_context");
  }
  actions.push("block_mission", "cancel_mission");
  return appendUniqueStrings(actions);
}

export const MISSION_COMMAND_BY_ACTION = Object.freeze(
  Object.fromEntries(
    [
      ...Object.entries(COMMANDS),
      ...Object.entries(CORRECTION_COMMANDS),
      ...Object.entries(EXECUTION_COMMANDS),
    ].map(
      ([commandType, command]) => [command.action, commandType],
    ),
  ),
);

const EVENT_PROJECTIONS = Object.fromEntries(
  Object.values(COMMANDS).map((command) => [command.eventType, command]),
);

const CORRECTION_EVENT_TYPES = new Set(
  [
    ...Object.values(CORRECTION_COMMANDS).map(
      (command) => command.eventType,
    ),
    "CORRECTION_DISPATCHED",
  ],
);

const AGENT_EVENT_TYPE_BY_OBSERVATION = Object.freeze({
  RUN_STARTED: "AGENT_RUN_STARTED",
  RUN_UPDATED: "AGENT_RUN_UPDATED",
  RUN_COMPLETED: "AGENT_RUN_COMPLETED",
  RUN_BLOCKED: "AGENT_RUN_BLOCKED",
});

const AGENT_EVENT_TYPES = new Set([
  "ASSIGNMENT_ROUTED",
  ...Object.values(AGENT_EVENT_TYPE_BY_OBSERVATION),
  "AGENT_RUN_ERROR",
]);

const EXECUTION_EVENT_TYPE_BY_OBSERVATION = Object.freeze({
  RUN_STARTED: "EXECUTION_RUN_STARTED",
  RUN_UPDATED: "EXECUTION_RUN_UPDATED",
  RUN_COMPLETED: "EXECUTION_RUN_COMPLETED",
  RUN_BLOCKED: "EXECUTION_RUN_BLOCKED",
});

const EXECUTION_EVENT_TYPES = new Set([
  "EXECUTION_WAVE_DISPATCHED",
  ...Object.values(EXECUTION_EVENT_TYPE_BY_OBSERVATION),
  "EXECUTION_RUN_ERROR",
  "EXECUTION_TRANSPORT_SETTLED",
  ...Object.values(EXECUTION_COMMANDS).map((command) => command.eventType),
]);

const EXECUTION_TRANSPORT_RELEASE_EVENT_TYPES = new Set([
  "EXECUTION_TRANSPORT_SETTLED",
  "EXECUTION_TRANSPORT_RECOVERED",
]);

function clone(value) {
  return structuredClone(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function getOpenExecutionTransportReservations(mission) {
  const reservations = new Map();
  for (const event of mission?.events ?? []) {
    if (
      event.type === "EXECUTION_WAVE_DISPATCHED" &&
      event.data?.transportReservationsTracked === true
    ) {
      for (const routing of event.data.routings ?? []) {
        const assignmentId = routing.assignment?.id;
        const waveId = event.data.wave?.id;
        reservations.set(`${waveId}:${assignmentId}`, {
          assignmentId,
          attempt: event.data.transportReservationAttempts?.[assignmentId],
          waveId,
          assignment: clone(routing.assignment),
          coordinationRequired: (event.data.wave?.reservedSlots ?? 0) > 0,
        });
      }
    }
    if (EXECUTION_TRANSPORT_RELEASE_EVENT_TYPES.has(event.type)) {
      const releaseDetails =
        event.type === "EXECUTION_TRANSPORT_RECOVERED"
          ? event.data?.recovery
          : event.data;
      reservations.delete(
        `${releaseDetails?.waveId}:${releaseDetails?.assignmentId}`,
      );
    }
  }
  return [...reservations.values()];
}

function normalizeLegacyOwnershipPath(path) {
  if (typeof path !== "string") {
    return path;
  }
  let normalized = path.trim().replaceAll("\\", "/");
  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }
  normalized = normalized.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  normalized = normalized
    .split("/")
    .filter((segment) => segment !== ".")
    .join("/");
  return normalized;
}

function normalizeLegacyAssignment(assignment) {
  if (!assignment?.ownershipBoundary) {
    return assignment;
  }
  const normalized = clone(assignment);
  for (const field of ["readPaths", "writePaths"]) {
    if (Array.isArray(normalized.ownershipBoundary[field])) {
      normalized.ownershipBoundary[field] =
        normalized.ownershipBoundary[field].map(normalizeLegacyOwnershipPath);
    }
  }
  return normalized;
}

function normalizeLegacyAgent(agent) {
  if (!agent || agent.roleId !== "sol_reviewer" || agent.independent === true) {
    return agent;
  }
  return { ...clone(agent), independent: true };
}

function normalizeLegacyEvent(event) {
  if (event?.schemaVersion !== undefined) {
    return clone(event);
  }
  const normalized = clone(event);
  if (normalized.type === "ASSIGNMENT_ROUTED") {
    normalized.data.assignment = normalizeLegacyAssignment(
      normalized.data.assignment,
    );
    normalized.data.agent = normalizeLegacyAgent(normalized.data.agent);
  }
  if (normalized.type === "PLAN_ACCEPTED" && normalized.data.plan?.taskGraph) {
    normalized.data.plan.taskGraph.assignments =
      normalized.data.plan.taskGraph.assignments.map(normalizeLegacyAssignment);
  }
  if (
    normalized.type === "EXECUTION_WAVE_DISPATCHED" &&
    Array.isArray(normalized.data.routings)
  ) {
    normalized.data.routings = normalized.data.routings.map((routing) => ({
      ...routing,
      assignment: normalizeLegacyAssignment(routing.assignment),
      agent: normalizeLegacyAgent(routing.agent),
    }));
  }
  return normalized;
}

function normalizeEventHistory(events) {
  return events.map(normalizeLegacyEvent);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function assertValidBrief(brief) {
  if (!brief || typeof brief !== "object") {
    throw new Error("A Brief is required.");
  }

  const missingFields = REQUIRED_BRIEF_FIELDS.filter((field) => {
    const value = brief[field];
    return (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    );
  });

  if (missingFields.length > 0) {
    throw new Error(`Brief is missing: ${missingFields.join(", ")}.`);
  }
  if (typeof brief.releaseRequired !== "boolean") {
    throw new Error("Brief releaseRequired must be a boolean.");
  }
  if (brief.releaseRequired === true) {
    const requiredReleasePlanFields = [
      "residualRisk",
      "intendedExternalAction",
      "rollbackCommitment",
    ];
    const missingReleasePlanFields = requiredReleasePlanFields.filter(
      (field) =>
        typeof brief.releasePlan?.[field] !== "string" ||
        brief.releasePlan[field].trim() === "",
    );
    if (missingReleasePlanFields.length > 0) {
      throw new Error(
        `Release-required Brief is missing releasePlan: ${missingReleasePlanFields.join(", ")}.`,
      );
    }
    if (brief.releaseAuthorized !== true) {
      throw new Error(
        "Release-required Brief must explicitly authorize release.",
      );
    }
  }
}

function assertAuditMetadata({ actor, reason }) {
  if (typeof actor !== "string" || actor.trim() === "") {
    throw new Error("Command actor is required.");
  }
  if (typeof reason !== "string" || reason.trim() === "") {
    throw new Error("Command reason is required.");
  }
}

function assertEventEnvelope(
  event,
  { expectedMissionId, expectedSequence, seenEventIds },
) {
  if (!event || typeof event !== "object") {
    throw new Error(`Cannot replay event ${expectedSequence}: event is missing.`);
  }
  if (
    event.schemaVersion !== undefined &&
    event.schemaVersion !== EVENT_SCHEMA_VERSION
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: event schema version is unsupported.`,
    );
  }
  if (event.sequence !== expectedSequence) {
    throw new Error(
      `Cannot replay event ${event.sequence}: expected sequence ${expectedSequence}.`,
    );
  }
  if (
    typeof event.id !== "string" ||
    event.id.trim() === "" ||
    seenEventIds.has(event.id)
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: event ID is missing or duplicated.`,
    );
  }
  if (event.missionId !== expectedMissionId) {
    throw new Error(
      `Cannot replay event ${event.sequence}: Mission ID does not match.`,
    );
  }
  if (
    typeof event.occurredAt !== "string" ||
    Number.isNaN(Date.parse(event.occurredAt))
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: timestamp is invalid.`,
    );
  }
  if (
    !Number.isInteger(event.contextPackVersion) ||
    event.contextPackVersion < 1
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: Context Pack version is invalid.`,
    );
  }
  if (
    !Array.isArray(event.evidenceRefs) ||
    event.evidenceRefs.some(
      (reference) =>
        typeof reference !== "string" || reference.trim() === "",
    )
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: Evidence references are invalid.`,
    );
  }
  if (!event.data || typeof event.data !== "object") {
    throw new Error(
      `Cannot replay event ${event.sequence}: event data is invalid.`,
    );
  }

  try {
    assertAuditMetadata(event);
  } catch (error) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${error.message}`,
    );
  }
  seenEventIds.add(event.id);
}

function assertReplayObject(value, event, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires ${field}.`,
    );
  }
}

function assertReplayString(value, event, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} has invalid ${field}.`,
    );
  }
}

function assertPassingGatePayload(payload, event, field) {
  if (typeof payload.summary !== "string" || payload.summary.trim() === "") {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires a passing ${field} summary.`,
    );
  }
  const assertPassingMarker = (value, label) => {
    if (
      value !== undefined &&
      !["PASS", "PASSED"].includes(String(value).toUpperCase())
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} has a non-passing ${field} ${label}.`,
      );
    }
  };
  assertPassingMarker(payload.outcome, "outcome");
  assertPassingMarker(payload.status, "status");
  assertPassingMarker(payload.details?.outcome, "details.outcome");
  assertPassingMarker(payload.details?.status, "details.status");
  if (payload.passed !== undefined && payload.passed !== true) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} has a non-passing ${field} result.`,
    );
  }
  if (payload.details?.passed !== undefined && payload.details.passed !== true) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} has a non-passing ${field} details.passed result.`,
    );
  }
}

function assertBlockDetails(block, errorPrefix) {
  if (
    !block ||
    typeof block !== "object" ||
    Array.isArray(block) ||
    typeof block.blocker !== "string" ||
    block.blocker.trim() === "" ||
    !Array.isArray(block.attemptedAlternatives) ||
    block.attemptedAlternatives.length === 0 ||
    block.attemptedAlternatives.some(
      (alternative) =>
        typeof alternative !== "string" || alternative.trim() === "",
    ) ||
    typeof block.requiredAuthorityOrInput !== "string" ||
    block.requiredAuthorityOrInput.trim() === ""
  ) {
    throw new Error(
      `${errorPrefix} requires blocker, attempted alternatives, and required authority or input.`,
    );
  }
}

function assertTransportRecoveryDetails(recovery, errorPrefix) {
  if (
    !recovery ||
    typeof recovery !== "object" ||
    Array.isArray(recovery) ||
    typeof recovery.assignmentId !== "string" ||
    recovery.assignmentId.trim() === "" ||
    typeof recovery.waveId !== "string" ||
    recovery.waveId.trim() === "" ||
    !Number.isInteger(recovery.attempt) ||
    recovery.attempt < 1 ||
    typeof recovery.summary !== "string" ||
    recovery.summary.trim() === ""
  ) {
    throw new Error(
      `${errorPrefix} requires Assignment, wave, attempt, and recovery summary.`,
    );
  }
}

function assertDistinctReleaseGateEvidence(mission, event) {
  if (!mission.brief.releaseRequired) {
    return;
  }
  const priorEvidenceRefs = appendUniqueStrings(
    mission.artifactEvidenceRefs ?? [],
    mission.reviewEvidenceRefs ?? [],
  );
  const eventEvidenceRefs = event.evidenceRefs;
  if (
    new Set(eventEvidenceRefs).size !== eventEvidenceRefs.length ||
    eventEvidenceRefs.some((reference) => priorEvidenceRefs.includes(reference))
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires Evidence refs distinct from earlier release gates.`,
    );
  }
}

function assertInspectableReleaseArtifacts(artifacts, event) {
  if (
    !Array.isArray(artifacts) ||
    artifacts.length === 0 ||
    artifacts.some((artifact) => !artifactHasInspectableDetail(artifact))
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: release-required candidate Artifacts must include inline diff, patch, or content before approval.`,
    );
  }
}

function appendUniqueStrings(...collections) {
  return [
    ...new Set(
      collections
        .flat()
        .filter((value) => typeof value === "string" && value.trim() !== ""),
    ),
  ];
}

function buildApprovalSnapshot(mission, decision, summary) {
  return {
    decision,
    summary,
    ...clone(mission.releaseReadiness),
  };
}

function assertCurrentReleaseDecision(
  mission,
  { actor, evidenceRefs, approval },
  expectedDecision,
  eventLabel,
) {
  if (
    !mission.brief.releaseRequired ||
    mission.brief.releaseAuthorized !== true ||
    !mission.releaseReadiness
  ) {
    throw new Error(`${eventLabel} requires current release readiness.`);
  }
  if (actor !== mission.brief.releaseAuthority) {
    throw new Error(
      `${eventLabel} requires release authority ${mission.brief.releaseAuthority}.`,
    );
  }
  if (
    !approval ||
    approval.decision !== expectedDecision ||
    typeof approval.summary !== "string" ||
    approval.summary.trim() === ""
  ) {
    throw new Error(`${eventLabel} requires a human decision summary.`);
  }
  const current = mission.releaseReadiness;
  const sameEvidence =
    Array.isArray(evidenceRefs) &&
    evidenceRefs.length === current.evidenceRefs.length &&
    evidenceRefs.every(
      (reference, index) => reference === current.evidenceRefs[index],
    );
  const snapshotMatches =
    approval.contextPackVersion === current.contextPackVersion &&
    artifactReference(approval.candidate) ===
      artifactReference(current.candidate) &&
    JSON.stringify(approval.candidate) ===
      JSON.stringify(current.candidate) &&
    JSON.stringify(approval.candidateArtifacts) ===
      JSON.stringify(current.candidateArtifacts) &&
    JSON.stringify(approval.evidenceRefs) ===
      JSON.stringify(current.evidenceRefs) &&
    approval.residualRisk === current.residualRisk &&
    approval.intendedExternalAction === current.intendedExternalAction &&
    approval.rollbackCommitment === current.rollbackCommitment;
  if (
    !sameEvidence ||
    !snapshotMatches ||
    evidenceRefs.some((reference) =>
      mission.invalidatedEvidenceRefs?.includes(reference),
    ) ||
    mission.invalidatedArtifactRefs?.includes(
      artifactReference(current.candidate),
    )
  ) {
    throw new Error(
      `${eventLabel} requires the exact current candidate and passing Evidence.`,
    );
  }
}

function invalidateCorrectionCandidate(
  mission,
  event,
  { includeEventEvidence = true } = {},
) {
  mission.invalidatedEvidenceRefs = appendUniqueStrings(
    mission.invalidatedEvidenceRefs ?? [],
    mission.artifactEvidenceRefs ?? [],
    mission.reviewEvidenceRefs ?? [],
    mission.validationEvidenceRefs ?? [],
    mission.approvalEvidenceRefs ?? [],
    includeEventEvidence ? event.evidenceRefs : [],
  );
  mission.invalidatedArtifactRefs = appendUniqueStrings(
    mission.invalidatedArtifactRefs ?? [],
    (mission.artifacts ?? [mission.artifact]).map(artifactReference),
  );
}

function assertAssignmentWithinMissionAuthority(mission, routing) {
  if (routing.agent.effectivePermission !== "workspace-write") {
    return;
  }
  const authority = mission.brief.mutationAuthority;
  const prefix = "workspace-write:";
  if (
    typeof authority !== "string" ||
    !authority.toLowerCase().startsWith(prefix)
  ) {
    throw new Error(
      "Assignment workspace-write permission exceeds Mission mutation authority.",
    );
  }
  let authorizedRoots;
  try {
    authorizedRoots = authority
      .slice(prefix.length)
      .split(",")
      .map((path) => canonicalOwnershipPath(path.trim()));
  } catch {
    throw new Error(
      "Mission mutation authority must declare canonical bounded relative roots.",
    );
  }
  const writePaths = routing.assignment.ownershipBoundary.writePaths.map(
    canonicalOwnershipPath,
  );
  if (
    authorizedRoots.length === 0 ||
    writePaths.some(
      (path) =>
        !authorizedRoots.some(
          (root) => path === root || path.startsWith(`${root}/`),
        ),
    )
  ) {
    throw new Error(
      "Assignment writable ownership exceeds Mission mutation authority.",
    );
  }
}

function projectAgentEvent(mission, event) {
  if (mission.execution) {
    throw new Error(
      `Cannot replay event ${event.sequence}: legacy agent events are unavailable for a Task Graph Mission.`,
    );
  }
  if (event.type === "ASSIGNMENT_ROUTED") {
    if (mission.status !== "PLANNED" || mission.assignment) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ASSIGNMENT_ROUTED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayObject(event.data.assignment, event, "assignment");
    assertReplayObject(event.data.agent, event, "agent");
    try {
      assertValidAgentAssignment(event.data.assignment);
    } catch (error) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${error.message}`,
      );
    }
    assertReplayString(event.data.agent.roleId, event, "agent role");
    assertReplayString(
      event.data.agent.effectivePermission,
      event,
      "effective permission",
    );
    if (
      event.data.assignment.effectivePermission !==
      event.data.agent.effectivePermission
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: Assignment and agent effective permission do not match.`,
      );
    }
    const expectedRouting = routeAgentAssignment(event.data.assignment);
    if (
      JSON.stringify(expectedRouting.assignment) !==
        JSON.stringify(event.data.assignment) ||
      JSON.stringify(expectedRouting.agent) !== JSON.stringify(event.data.agent)
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: routed Assignment does not match the canonical routing policy.`,
      );
    }
    assertAssignmentWithinMissionAuthority(mission, expectedRouting);
    mission.assignment = clone(event.data.assignment);
    mission.agent = clone(event.data.agent);
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (!mission.assignment || !mission.agent) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires a routed Assignment.`,
    );
  }
  assertReplayObject(event.data.run, event, "run");

  if (event.type === "AGENT_RUN_STARTED") {
    const startsDispatchedCorrection =
      mission.status === "RUNNING" &&
      mission.correctionActive === true &&
      mission.run?.status === "ASSIGNED";
    if (
      !(
        (mission.status === "PLANNED" && !mission.run) ||
        startsDispatchedCorrection
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: AGENT_RUN_STARTED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayString(event.data.run.id, event, "Run ID");
    if (event.data.run.status !== "WORKING") {
      throw new Error(
        `Cannot replay event ${event.sequence}: AGENT_RUN_STARTED must be WORKING.`,
      );
    }
    mission.status = "RUNNING";
    mission.run = {
      ...clone(event.data.run),
      ...(startsDispatchedCorrection
        ? { agentRole: mission.agent.roleId }
        : {}),
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "AGENT_RUN_ERROR") {
    if (
      !["PLANNED", "RUNNING"].includes(mission.status) ||
      event.data.run.status !== "ERROR" ||
      typeof event.data.run.error !== "string" ||
      event.data.run.error.trim() === "" ||
      (mission.run && event.data.run.id !== mission.run.id)
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: Run error is invalid.`,
      );
    }
    mission.run = clone(event.data.run);
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (
    mission.status !== "RUNNING" ||
    !mission.run ||
    event.data.run.id !== mission.run.id
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} does not match the active Run.`,
    );
  }

  if (event.type === "AGENT_RUN_UPDATED") {
    if (
      mission.run.status !== "WORKING" ||
      event.data.run.status !== "WORKING"
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: AGENT_RUN_UPDATED requires a working Run.`,
      );
    }
    mission.run = clone(event.data.run);
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "AGENT_RUN_COMPLETED") {
    if (mission.run.status !== "WORKING") {
      throw new Error(
        `Cannot replay event ${event.sequence}: completed Run is not active.`,
      );
    }
    if (
      event.data.run.status !== "COMPLETED" ||
      !Array.isArray(event.data.artifacts) ||
      event.data.artifacts.length === 0 ||
      !Array.isArray(event.data.run.evidence) ||
      event.data.run.evidence.length === 0 ||
      event.evidenceRefs.length === 0
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: completed Run requires structured Artifacts and Evidence.`,
      );
    }
    const evidenceRefs = event.data.run.evidence.map((item) => item.ref);
    if (
      evidenceRefs.some(
        (reference) =>
          typeof reference !== "string" || reference.trim() === "",
      ) ||
      evidenceRefs.length !== event.evidenceRefs.length ||
      evidenceRefs.some(
        (reference, index) => reference !== event.evidenceRefs[index],
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: completed Run Evidence references do not match.`,
      );
    }
    if (
      evidenceRefs.some((reference) =>
        (mission.invalidatedEvidenceRefs ?? []).includes(reference),
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: completed Run requires current Evidence.`,
      );
    }
    const artifactRefs = event.data.artifacts.map(artifactReference);
    if (
      artifactRefs.some(
        (reference) =>
          !reference ||
          (mission.invalidatedArtifactRefs ?? []).includes(reference),
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: completed Run requires regenerated Artifact references.`,
      );
    }
    mission.status = "IN_REVIEW";
    mission.run = clone(event.data.run);
    mission.artifacts = clone(event.data.artifacts);
    mission.artifact = clone(event.data.artifacts[0]);
    mission.artifactEvidenceRefs = clone(event.evidenceRefs);
    mission.allowedActions = [COMMAND_BY_STATUS.IN_REVIEW.action];
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "AGENT_RUN_BLOCKED") {
    if (
      event.data.run.status !== "BLOCKED" ||
      typeof event.data.run.blocker !== "string" ||
      !Array.isArray(event.data.run.attemptedAlternatives) ||
      typeof event.data.run.requiredAuthorityOrInput !== "string"
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: blocked Run outcome is invalid.`,
      );
    }
    mission.run = clone(event.data.run);
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

}

function syncMissionExecutionOutputs(mission) {
  const completedNodes = mission.execution.nodes.filter(
    (node) => node.status === "COMPLETED",
  );
  const candidateNodes = completedNodes.filter(
    (node) => node.assignment.workKind !== "review",
  );
  const reviewNodes = completedNodes.filter(
    (node) => node.assignment.workKind === "review",
  );
  mission.artifacts = candidateNodes.flatMap((node) => clone(node.artifacts));
  mission.artifact = mission.artifacts[0] ? clone(mission.artifacts[0]) : null;
  mission.artifactEvidenceRefs = appendUniqueStrings(
    ...candidateNodes.map((node) => node.evidenceRefs),
  );
  mission.executionReviewEvidenceRefs = appendUniqueStrings(
    ...reviewNodes.map((node) => node.evidenceRefs),
  );
  mission.executionReviewOutcome = reviewNodes[0]?.reviewOutcome
    ? clone(reviewNodes[0].reviewOutcome)
    : null;
  return completedNodes;
}

function assertCurrentIndependentReviewerEvidence(mission, event) {
  const reviewer = mission.execution?.nodes.find(
    (node) =>
      node.status === "COMPLETED" &&
      node.agent?.roleId === "sol_reviewer" &&
      node.agent?.effectivePermission === "read-only" &&
      node.agent?.independent === true &&
      node.reviewOutcome?.outcome === "PASSED" &&
      event.data.review.reviewerAssignmentId === node.assignment.id &&
      event.data.review.outcome === node.reviewOutcome.outcome &&
      sameValue(
        event.data.review.candidateArtifactRefs,
        node.reviewOutcome.candidateArtifactRefs,
      ) &&
      sameValue(event.data.review.findings, node.reviewOutcome.findings) &&
      event.actor === "agent:sol_reviewer" &&
      event.evidenceRefs.length === node.evidenceRefs.length &&
      event.evidenceRefs.every(
        (reference, index) => reference === node.evidenceRefs[index],
      ),
  );
  if (!reviewer) {
    throw new Error(
      `Cannot replay event ${event.sequence}: review outcome requires a current passing structured reviewer outcome, independent Sol Reviewer Evidence, and actor.`,
    );
  }
}

function projectExecutionEvent(mission, event) {
  if (EXECUTION_TRANSPORT_RELEASE_EVENT_TYPES.has(event.type)) {
    const releaseDetails =
      event.type === "EXECUTION_TRANSPORT_RECOVERED"
        ? event.data?.recovery
        : event.data;
    const { assignmentId, waveId, attempt } = releaseDetails ?? {};
    if (
      (event.type === "EXECUTION_TRANSPORT_SETTLED" &&
        event.actor !== "agent-router") ||
      (event.type === "EXECUTION_TRANSPORT_RECOVERED" &&
        (event.actor === "agent-router" || event.actor.startsWith("agent:"))) ||
      typeof assignmentId !== "string" ||
      assignmentId.trim() === "" ||
      typeof waveId !== "string" ||
      waveId.trim() === "" ||
      !Number.isInteger(attempt) ||
      attempt < 1
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: execution transport release is invalid.`,
      );
    }
    if (event.type === "EXECUTION_TRANSPORT_RECOVERED") {
      if (!["BLOCKED", "CANCELLED"].includes(mission.status)) {
        throw new Error(
          `Cannot replay event ${event.sequence}: execution transport recovery requires a blocked or cancelled Mission.`,
        );
      }
      assertTransportRecoveryDetails(
        event.data.recovery,
        `Cannot replay event ${event.sequence}: execution transport recovery`,
      );
      if (
        event.data.recovery.assignmentId !== assignmentId ||
        event.data.recovery.waveId !== waveId ||
        event.data.recovery.attempt !== attempt
      ) {
        throw new Error(
          `Cannot replay event ${event.sequence}: execution transport recovery details do not match the released reservation.`,
        );
      }
    }
    const dispatch = mission.events.find(
      (candidate) =>
        candidate.sequence < event.sequence &&
        candidate.type === "EXECUTION_WAVE_DISPATCHED" &&
        candidate.data?.transportReservationsTracked === true &&
        candidate.data?.wave?.id === waveId &&
        candidate.data.wave.assignmentIds?.includes(assignmentId) &&
        candidate.data.transportReservationAttempts?.[assignmentId] === attempt,
    );
    const duplicate = mission.events.some(
      (candidate) =>
        candidate.sequence < event.sequence &&
        EXECUTION_TRANSPORT_RELEASE_EVENT_TYPES.has(candidate.type) &&
        candidate.data?.waveId === waveId &&
        candidate.data?.assignmentId === assignmentId,
    );
    if (!dispatch || duplicate) {
      throw new Error(
        `Cannot replay event ${event.sequence}: execution transport release does not match one open reservation.`,
      );
    }
    return;
  }
  if (!mission.execution) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires a Task Graph.`,
    );
  }
  const isDecisionEvent = [
    "DECISION_ROOM_OPENED",
    "DECISION_ROOM_RESOLVED",
  ].includes(event.type);
  if (
    event.type === "EXECUTION_WAVE_DISPATCHED" &&
    event.data?.transportReservationsTracked !== true
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: execution wave dispatch requires durable transport reservation tracking.`,
    );
  }
  if (
    event.type === "EXECUTION_WAVE_DISPATCHED" &&
    Array.isArray(event.data.routings)
  ) {
    const reservationAttempts = event.data.transportReservationAttempts;
    const assignmentIds = event.data.wave?.assignmentIds ?? [];
    if (
      !reservationAttempts ||
      typeof reservationAttempts !== "object" ||
      Array.isArray(reservationAttempts) ||
      assignmentIds.some((assignmentId) => {
        const node = mission.execution.nodes.find(
          (candidate) => candidate.assignment.id === assignmentId,
        );
        return (
          !Number.isInteger(reservationAttempts[assignmentId]) ||
          reservationAttempts[assignmentId] !== (node?.attempt ?? -1) + 1
        );
      })
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: execution wave dispatch requires one current transport reservation attempt per Assignment.`,
      );
    }
  }
  if (
    event.type === "EXECUTION_WAVE_DISPATCHED" &&
    Array.isArray(event.data.routings)
  ) {
    for (const routing of event.data.routings) {
      assertAssignmentWithinMissionAuthority(mission, routing);
    }
  }
  if (event.type === "EXECUTION_WAVE_DISPATCHED" || isDecisionEvent) {
    if (
      !["PLANNED", "RUNNING", "CHANGES_REQUESTED"].includes(mission.status)
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} is not allowed while Mission is ${mission.status}.`,
      );
    }
  } else if (mission.status !== "RUNNING") {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires a running Mission.`,
    );
  }

  if (
    event.evidenceRefs.some((reference) =>
      (mission.invalidatedEvidenceRefs ?? []).includes(reference),
    )
  ) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires current Evidence.`,
    );
  }

  if (event.type === "EXECUTION_RUN_COMPLETED") {
    const artifactRefs = event.data.artifacts?.map(artifactReference) ?? [];
    if (
      event.evidenceRefs.some((reference) =>
        (mission.invalidatedEvidenceRefs ?? []).includes(reference),
      ) ||
      artifactRefs.some(
        (reference) =>
          !reference ||
          (mission.invalidatedArtifactRefs ?? []).includes(reference),
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: corrected execution Run requires regenerated Artifact and Evidence references.`,
      );
    }
  }

  try {
    mission.execution = projectTaskExecutionEvent(mission.execution, event);
  } catch (error) {
    throw new Error(`Cannot replay event ${event.sequence}: ${error.message}`);
  }

  if (isDecisionEvent) {
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  const completedNodes = syncMissionExecutionOutputs(mission);
  if (
    completedNodes.length > 0 &&
    completedNodes.length === mission.execution.nodes.length
  ) {
    mission.status = "IN_REVIEW";
  } else {
    mission.status = "RUNNING";
  }
  mission.allowedActions = allowedActionsForMission(mission);
}

function projectCorrectionEvent(mission, event) {
  if (event.type === "RELEASE_REJECTED") {
    if (mission.status !== "APPROVAL_REQUIRED") {
      throw new Error(
        `Cannot replay event ${event.sequence}: RELEASE_REJECTED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertCurrentReleaseDecision(
      mission,
      {
        actor: event.actor,
        evidenceRefs: event.evidenceRefs,
        approval: event.data.approval,
      },
      "REJECTED",
      "RELEASE_REJECTED",
    );
    invalidateCorrectionCandidate(mission, event);
    mission.status = "CHANGES_REQUESTED";
    mission.approval = clone(event.data.approval);
    mission.approvalEvidenceRefs = clone(event.evidenceRefs);
    mission.releaseReadiness = null;
    mission.changeRequest = {
      source: "APPROVAL",
      reason: event.data.approval.summary,
      evidenceRefs: clone(event.evidenceRefs),
      requestedAtSequence: event.sequence,
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "REVIEW_REJECTED") {
    if (mission.status !== "IN_REVIEW") {
      throw new Error(
        `Cannot replay event ${event.sequence}: REVIEW_REJECTED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayObject(event.data.review, event, "review");
    if (event.evidenceRefs.length === 0) {
      throw new Error(
        `Cannot replay event ${event.sequence}: REVIEW_REJECTED requires Evidence.`,
      );
    }
    if (mission.execution) {
      assertReplayString(event.data.review.summary, event, "review summary");
      const reviewerNode = mission.execution.nodes.find(
        (node) =>
          node.assignment.id === event.data.review.reviewerAssignmentId,
      );
      if (
        !reviewerNode ||
        event.actor !== `agent:${reviewerNode.agent?.roleId}` ||
        event.data.review.outcome !== "CHANGES_REQUESTED" ||
        !sameValue(
          event.data.review.candidateArtifactRefs,
          reviewerNode.reviewOutcome?.candidateArtifactRefs,
        ) ||
        event.evidenceRefs.length !== reviewerNode.evidenceRefs.length ||
        event.evidenceRefs.some(
          (reference, index) =>
            reference !== reviewerNode.evidenceRefs[index],
        )
      ) {
        throw new Error(
          `Cannot replay event ${event.sequence}: REVIEW_REJECTED requires current independent reviewer Evidence and actor.`,
        );
      }
      let correction;
      try {
        correction = applyTaskReviewFindings(
          mission.execution,
          event.data.review,
        );
      } catch (error) {
        throw new Error(
          `Cannot replay event ${event.sequence}: ${error.message}`,
        );
      }
      mission.execution = correction.execution;
      mission.invalidatedArtifactRefs = appendUniqueStrings(
        mission.invalidatedArtifactRefs ?? [],
        correction.invalidatedArtifactRefs,
      );
      mission.invalidatedEvidenceRefs = appendUniqueStrings(
        mission.invalidatedEvidenceRefs ?? [],
        correction.invalidatedEvidenceRefs,
        event.evidenceRefs,
      );
      mission.status = "CHANGES_REQUESTED";
      mission.review = {
        ...clone(event.data.review),
        outcome: "FAILED",
      };
      mission.reviewEvidenceRefs = clone(event.evidenceRefs);
      mission.validation = null;
      mission.validationEvidenceRefs = null;
      mission.releaseReadiness = null;
      mission.approval = null;
      mission.approvalEvidenceRefs = null;
      syncMissionExecutionOutputs(mission);
      mission.changeRequest = {
        source: "REVIEW",
        reason: event.reason,
        evidenceRefs: clone(event.evidenceRefs),
        affectedAssignmentIds: clone(correction.affectedAssignmentIds),
        requestedAtSequence: event.sequence,
      };
      mission.allowedActions = allowedActionsForMission(mission);
      return;
    }
    invalidateCorrectionCandidate(mission, event);
    mission.status = "CHANGES_REQUESTED";
    mission.review = {
      ...clone(event.data.review),
      outcome: "FAILED",
    };
    mission.reviewEvidenceRefs = clone(event.evidenceRefs);
    mission.validation = null;
    mission.validationEvidenceRefs = null;
    mission.releaseReadiness = null;
    mission.approval = null;
    mission.approvalEvidenceRefs = null;
    mission.changeRequest = {
      source: "REVIEW",
      reason: event.reason,
      evidenceRefs: clone(event.evidenceRefs),
      requestedAtSequence: event.sequence,
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "VALIDATION_FAILED") {
    if (mission.status !== "VALIDATING") {
      throw new Error(
        `Cannot replay event ${event.sequence}: VALIDATION_FAILED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayObject(event.data.validation, event, "validation");
    if (event.evidenceRefs.length === 0) {
      throw new Error(
        `Cannot replay event ${event.sequence}: VALIDATION_FAILED requires Evidence.`,
      );
    }
    invalidateCorrectionCandidate(mission, event);
    mission.status = "CHANGES_REQUESTED";
    mission.validation = {
      ...clone(event.data.validation),
      outcome: "FAILED",
    };
    mission.validationEvidenceRefs = clone(event.evidenceRefs);
    mission.changeRequest = {
      source: "VALIDATION",
      reason: event.reason,
      evidenceRefs: clone(event.evidenceRefs),
      requestedAtSequence: event.sequence,
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (
    ["CORRECTION_DISPATCHED", "CORRECTION_STARTED"].includes(
      event.type,
    )
  ) {
    const restartsInterruptedRun =
      mission.status === "RUNNING" &&
      Boolean(mission.assignment) &&
      ["INTERRUPTED", "BLOCKED", "ERROR"].includes(mission.run?.status);
    if (
      !(
        (mission.status === "CHANGES_REQUESTED" && mission.changeRequest) ||
        restartsInterruptedRun
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayObject(event.data.run, event, "run");
    if (
      mission.agent &&
      event.data.run.agentRole !== mission.agent.roleId
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} must return work to assigned role ${mission.agent.roleId}.`,
      );
    }
    if (
      event.type === "CORRECTION_DISPATCHED" &&
      event.data.run.status !== "ASSIGNED"
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: CORRECTION_DISPATCHED must reserve an assigned Run.`,
      );
    }
    mission.status = "RUNNING";
    mission.run = clone(event.data.run);
    mission.artifact = null;
    mission.artifacts = null;
    mission.artifactEvidenceRefs = null;
    mission.review = null;
    mission.reviewEvidenceRefs = null;
    mission.validation = null;
    mission.validationEvidenceRefs = null;
    mission.releaseReadiness = null;
    mission.approval = null;
    mission.approvalEvidenceRefs = null;
    if (mission.changeRequest) {
      mission.lastChangeRequest = clone(mission.changeRequest);
    }
    mission.changeRequest = null;
    mission.correctionActive = true;
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "CONTEXT_REVISED") {
    const command = CORRECTION_COMMANDS.REVISE_CONTEXT;
    if (!command.from.includes(mission.status)) {
      throw new Error(
        `Cannot replay event ${event.sequence}: CONTEXT_REVISED is not allowed while Mission is ${mission.status}.`,
      );
    }
    if (event.contextPackVersion !== mission.contextPackVersion + 1) {
      throw new Error(
        `Cannot replay event ${event.sequence}: Context revision must increment the Context Pack version by one.`,
      );
    }
    assertReplayObject(event.data.context, event, "context");
    invalidateCorrectionCandidate(mission, event, {
      includeEventEvidence: false,
    });
    const previousVersion = mission.contextPackVersion;
    mission.status = "CONTEXT_READY";
    mission.contextPackVersion = event.contextPackVersion;
    mission.context = clone(event.data.context);
    mission.plan = null;
    mission.execution = null;
    mission.executionReviewEvidenceRefs = null;
    mission.assignment = null;
    mission.agent = null;
    mission.run = null;
    mission.artifacts = null;
    mission.artifact = null;
    mission.artifactEvidenceRefs = null;
    mission.review = null;
    mission.reviewEvidenceRefs = null;
    mission.validation = null;
    mission.validationEvidenceRefs = null;
    mission.releaseReadiness = null;
    mission.approval = null;
    mission.approvalEvidenceRefs = null;
    mission.learning = null;
    mission.completion = null;
    mission.lastChangeRequest = mission.changeRequest
      ? clone(mission.changeRequest)
      : (mission.lastChangeRequest ?? null);
    mission.changeRequest = null;
    mission.contextRevision = {
      fromVersion: previousVersion,
      toVersion: event.contextPackVersion,
      reason: event.reason,
      revisedAtSequence: event.sequence,
    };
    mission.correctionActive = false;
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "MISSION_BLOCKED") {
    if (!CORRECTION_COMMANDS.BLOCK_MISSION.from.includes(mission.status)) {
      throw new Error(
        `Cannot replay event ${event.sequence}: MISSION_BLOCKED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertBlockDetails(
      event.data.block,
      `Cannot replay event ${event.sequence}: MISSION_BLOCKED`,
    );
    mission.blockedFrom = mission.status;
    mission.blockedAllowedActions = clone(mission.allowedActions);
    if (mission.status === "RUNNING" && mission.execution) {
      mission.execution = interruptTaskExecution(mission.execution, {
        status: "INTERRUPTED",
        occurredAt: event.occurredAt,
        reason: event.reason,
      });
      syncMissionExecutionOutputs(mission);
    }
    if (
      mission.status === "RUNNING" &&
      mission.assignment &&
      mission.run?.status === "WORKING"
    ) {
      mission.run = {
        ...clone(mission.run),
        status: "INTERRUPTED",
        updatedAt: event.occurredAt,
        interruptionReason: event.reason,
      };
    }
    mission.status = "BLOCKED";
    mission.block = {
      ...clone(event.data.block),
      reason: event.reason,
      blockedAtSequence: event.sequence,
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "MISSION_RESUMED") {
    if (
      mission.status !== "BLOCKED" ||
      typeof mission.blockedFrom !== "string" ||
      !mission.block
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: MISSION_RESUMED requires a blocked Mission with a prior safe state.`,
      );
    }
    assertReplayObject(event.data.resumption, event, "resumption");
    assertReplayString(
      event.data.resumption.summary,
      event,
      "resumption summary",
    );
    const safeStatus = mission.blockedFrom;
    if (mission.execution) {
      mission.execution = resumeInterruptedTaskExecution(mission.execution);
      syncMissionExecutionOutputs(mission);
    }
    mission.status = safeStatus;
    mission.lastBlock = clone(mission.block);
    mission.block = null;
    mission.blockedFrom = null;
    mission.blockedAllowedActions = null;
    mission.resume = {
      fromStatus: "BLOCKED",
      toStatus: safeStatus,
      reason: event.reason,
      summary: event.data.resumption.summary,
      resumedAtSequence: event.sequence,
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  if (event.type === "MISSION_CANCELLED") {
    if (!CORRECTION_COMMANDS.CANCEL_MISSION.from.includes(mission.status)) {
      throw new Error(
        `Cannot replay event ${event.sequence}: MISSION_CANCELLED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayObject(event.data.cancellation, event, "cancellation");
    assertReplayString(
      event.data.cancellation.summary,
      event,
      "cancellation summary",
    );
    const cancelledFrom = mission.status;
    if (mission.execution) {
      mission.execution = interruptTaskExecution(mission.execution, {
        status: "CANCELLED",
        occurredAt: event.occurredAt,
        reason: event.reason,
      });
      syncMissionExecutionOutputs(mission);
    }
    mission.status = "CANCELLED";
    mission.cancelledFrom = cancelledFrom;
    mission.cancellation = {
      summary: event.data.cancellation.summary,
      reason: event.reason,
      cancelledAtSequence: event.sequence,
    };
    mission.allowedActions = allowedActionsForMission(mission);
    return;
  }

  throw new Error(`Cannot replay unknown correction event: ${event.type}.`);
}

function projectMission(events, expectedMissionId) {
  const created = events[0];
  const seenEventIds = new Set();
  assertEventEnvelope(created, {
    expectedMissionId,
    expectedSequence: 1,
    seenEventIds,
  });
  if (created.type !== "MISSION_CREATED") {
    throw new Error("Cannot replay event 1: expected MISSION_CREATED.");
  }
  assertValidBrief(created.data.brief);

  const mission = {
    id: created.missionId,
    status: "BRIEF_ACCEPTED",
    contextPackVersion: created.contextPackVersion,
    brief: clone(created.data.brief),
    context: null,
    plan: null,
    execution: null,
    executionReviewEvidenceRefs: null,
    run: null,
    artifact: null,
    review: null,
    validation: null,
    releaseReadiness: null,
    approval: null,
    learning: null,
    completion: null,
    events: clone(events),
    allowedActions: [],
  };
  mission.allowedActions = allowedActionsForMission(mission);

  for (const [index, event] of events.slice(1).entries()) {
    assertEventEnvelope(event, {
      expectedMissionId,
      expectedSequence: index + 2,
      seenEventIds,
    });
    if (AGENT_EVENT_TYPES.has(event.type)) {
      if (event.contextPackVersion !== mission.contextPackVersion) {
        throw new Error(
          `Cannot replay event ${event.sequence}: Context Pack version does not match.`,
        );
      }
      projectAgentEvent(mission, event);
      continue;
    }
    if (EXECUTION_EVENT_TYPES.has(event.type)) {
      if (event.contextPackVersion !== mission.contextPackVersion) {
        throw new Error(
          `Cannot replay event ${event.sequence}: Context Pack version does not match.`,
        );
      }
      projectExecutionEvent(mission, event);
      continue;
    }
    if (CORRECTION_EVENT_TYPES.has(event.type)) {
      if (
        event.type !== "CONTEXT_REVISED" &&
        event.contextPackVersion !== mission.contextPackVersion
      ) {
        throw new Error(
          `Cannot replay event ${event.sequence}: Context Pack version does not match.`,
        );
      }
      projectCorrectionEvent(mission, event);
      continue;
    }
    const projection = EVENT_PROJECTIONS[event.type];
    if (!projection) {
      throw new Error(`Cannot replay unknown event: ${event.type}.`);
    }
    if (event.contextPackVersion !== mission.contextPackVersion) {
      throw new Error(
        `Cannot replay event ${event.sequence}: Context Pack version does not match.`,
      );
    }
    if (mission.status !== projection.from) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} is not allowed while Mission is ${mission.status}.`,
      );
    }
    if (
      event.data[projection.field] === null ||
      typeof event.data[projection.field] !== "object"
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} requires ${projection.field}.`,
      );
    }
    if (event.type === "REVIEW_PASSED") {
      assertPassingGatePayload(event.data.review, event, "review");
      if (mission.execution) {
        assertCurrentIndependentReviewerEvidence(mission, event);
      }
      assertDistinctReleaseGateEvidence(mission, event);
    }
    if (event.type === "VALIDATION_PASSED") {
      assertPassingGatePayload(event.data.validation, event, "validation");
      assertDistinctReleaseGateEvidence(mission, event);
    }
    if (projection.requiresEvidence && event.evidenceRefs.length === 0) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} requires Evidence.`,
      );
    }
    if (
      event.type === "MISSION_COMPLETED" &&
      mission.brief.releaseRequired
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: release-required Mission cannot complete locally.`,
      );
    }
    if (event.type === "RELEASE_APPROVED") {
      assertCurrentReleaseDecision(
        mission,
        {
          actor: event.actor,
          evidenceRefs: event.evidenceRefs,
          approval: event.data.approval,
        },
        "APPROVED",
        "RELEASE_APPROVED",
      );
    }
    if (
      projection.requiresEvidence &&
      event.evidenceRefs.some((reference) =>
        mission.invalidatedEvidenceRefs?.includes(reference),
      )
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ${event.type} requires current Evidence.`,
      );
    }
    if (
      event.type === "ARTIFACT_SUBMITTED" &&
      (!artifactReference(event.data.artifact) ||
        mission.invalidatedArtifactRefs?.includes(
          artifactReference(event.data.artifact),
        ))
    ) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ARTIFACT_SUBMITTED requires a regenerated Artifact reference.`,
      );
    }
    if (event.type === "VALIDATION_PASSED" && mission.brief.releaseRequired) {
      assertInspectableReleaseArtifacts(
        mission.artifacts ?? [mission.artifact],
        event,
      );
    }

    mission.status =
      event.type === "VALIDATION_PASSED" &&
      mission.brief.releaseRequired
        ? "APPROVAL_REQUIRED"
        : projection.to;
    mission[projection.field] = clone(event.data[projection.field]);
    if (event.type === "PLAN_ACCEPTED") {
      mission.execution = null;
      mission.executionReviewEvidenceRefs = null;
      if (event.data.plan.taskGraph) {
        try {
          mission.execution = createTaskExecution(event.data.plan.taskGraph, {
            requireIndependentReview: true,
          });
          for (const node of mission.execution.nodes) {
            assertAssignmentWithinMissionAuthority(
              mission,
              routeAgentAssignment(node.assignment),
            );
          }
        } catch (error) {
          throw new Error(
            `Cannot replay event ${event.sequence}: ${error.message}`,
          );
        }
      }
    }
    if (
      event.type === "VALIDATION_PASSED" &&
      mission.brief.releaseRequired
    ) {
      mission.releaseReadiness = {
        candidate: clone(mission.artifact),
        candidateArtifacts: clone(
          mission.artifacts ?? [mission.artifact],
        ),
        contextPackVersion: mission.contextPackVersion,
        evidenceRefs: appendUniqueStrings(
          mission.artifactEvidenceRefs ?? [],
          mission.reviewEvidenceRefs ?? [],
          event.evidenceRefs,
        ),
        ...clone(mission.brief.releasePlan),
      };
    }
    if (event.type === "ARTIFACT_SUBMITTED") {
      mission.correctionActive = false;
    }
    if (projection.requiresEvidence) {
      mission[`${projection.field}EvidenceRefs`] = clone(event.evidenceRefs);
    }
    mission.allowedActions = allowedActionsForMission(mission);
  }

  return deepFreeze(mission);
}

export function createMemoryEventStore(seed = {}) {
  const eventsByMission = new Map(
    Object.entries(seed).map(([missionId, events]) => [
      missionId,
      clone(events),
    ]),
  );
  const listeners = new Set();

  const notify = (change) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        // A projection/render listener cannot roll back an appended event.
      }
    }
  };

  return {
    append(missionId, events, { expectedSequence } = {}) {
      const existing = eventsByMission.get(missionId) ?? [];
      if (
        expectedSequence !== undefined &&
        existing.length !== expectedSequence
      ) {
        throw new Error(
          `Event history changed: expected ${expectedSequence} events but found ${existing.length}.`,
        );
      }
      eventsByMission.set(missionId, [...existing, ...clone(events)]);
      notify({ missionId, events: clone(events), source: "local" });
    },
    load(missionId) {
      return clone(eventsByMission.get(missionId) ?? []);
    },
    listMissionIds() {
      return [...eventsByMission.keys()];
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new Error("Event-store subscriber must be a function.");
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function createLocalStorageEventStore({
  storage = globalThis.localStorage,
  key = "codex-mission-control-events-v1",
  eventTarget = globalThis,
} = {}) {
  if (!storage) {
    throw new Error("A local storage implementation is required.");
  }
  const listeners = new Set();
  const notify = (change) => {
    for (const listener of listeners) {
      try {
        listener(change);
      } catch {
        // A projection/render listener cannot roll back an appended event.
      }
    }
  };
  const parseStorageValue = (serialized) => {
    if (!serialized) return {};
    try {
      const parsed = JSON.parse(serialized);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : null;
    } catch {
      return null;
    }
  };
  const handleStorage = (event) => {
    if (event?.key === key && event.storageArea === storage) {
      const previous = parseStorageValue(event.oldValue);
      const current = parseStorageValue(
        event.newValue ?? storage.getItem(key),
      );
      if (!previous || !current) {
        notify({ missionId: null, events: [], source: "storage" });
        return;
      }
      const missionIds = new Set([
        ...Object.keys(previous),
        ...Object.keys(current),
      ]);
      for (const missionId of missionIds) {
        if (!sameValue(previous[missionId], current[missionId])) {
          notify({ missionId, events: [], source: "storage" });
        }
      }
    }
  };

  function readAll() {
    const serialized = storage.getItem(key);
    if (!serialized) {
      return {};
    }

    const parsed = JSON.parse(serialized);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Stored Mission event history is malformed.");
    }
    return parsed;
  }

  return {
    append(missionId, events, { expectedSequence } = {}) {
      const allEvents = readAll();
      const existing = allEvents[missionId] ?? [];
      if (
        expectedSequence !== undefined &&
        existing.length !== expectedSequence
      ) {
        throw new Error(
          `Event history changed: expected ${expectedSequence} events but found ${existing.length}.`,
        );
      }
      allEvents[missionId] = [...existing, ...clone(events)];
      storage.setItem(key, JSON.stringify(allEvents));
      notify({ missionId, events: clone(events), source: "local" });
    },
    load(missionId) {
      return clone(readAll()[missionId] ?? []);
    },
    listMissionIds() {
      return Object.keys(readAll());
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        throw new Error("Event-store subscriber must be a function.");
      }
      const shouldConnect = listeners.size === 0;
      listeners.add(listener);
      if (shouldConnect && typeof eventTarget?.addEventListener === "function") {
        eventTarget.addEventListener("storage", handleStorage);
      }
      return () => {
        listeners.delete(listener);
        if (
          listeners.size === 0 &&
          typeof eventTarget?.removeEventListener === "function"
        ) {
          eventTarget.removeEventListener("storage", handleStorage);
        }
      };
    },
  };
}

export function createBrowserWriteCoordinator({
  locks = globalThis.navigator?.locks,
  lockName = "codex-mission-control-event-store-v1",
} = {}) {
  if (!locks || typeof locks.request !== "function") {
    throw new Error(
      "Cross-tab write coordination is unavailable in this browser.",
    );
  }

  return {
    runExclusive(task) {
      return locks.request(lockName, { mode: "exclusive" }, task);
    },
  };
}

export function createMissionOrchestrator({
  eventStore,
  agentRouter = null,
  clock = () => new Date().toISOString(),
  createId = (kind) => `${kind}-${crypto.randomUUID()}`,
  writeCoordinator = { runExclusive: (task) => task() },
}) {
  if (!eventStore) {
    throw new Error("An event store is required.");
  }
  if (!writeCoordinator || typeof writeCoordinator.runExclusive !== "function") {
    throw new Error("A write coordinator is required.");
  }
  if (
    agentRouter &&
    (typeof agentRouter.route !== "function" ||
      typeof agentRouter.run !== "function")
  ) {
    throw new Error("The agent router must expose route() and run().");
  }
  const activeExecutionRunControllers = new Map();

  function executionRunKey(missionId, waveId, assignmentId, attempt) {
    return `${missionId}:${waveId}:${assignmentId}:${attempt}`;
  }

  function abortMissionExecutionRuns(missionId, reason) {
    for (const [key, controller] of activeExecutionRunControllers) {
      if (key.startsWith(`${missionId}:`)) {
        controller.abort(new Error(reason));
      }
    }
  }

  eventStore.subscribe?.((change) => {
    if (!change?.missionId && change?.source === "storage") {
      for (const controller of activeExecutionRunControllers.values()) {
        controller.abort(
          new Error("Mission history changed in another browser context"),
        );
      }
      return;
    }
    if (
      !change?.missionId ||
      ![...activeExecutionRunControllers.keys()].some((key) =>
        key.startsWith(`${change.missionId}:`),
      )
    ) {
      return;
    }
    try {
      const mission = getMission(change.missionId);
      if (
        ["BLOCKED", "CANCELLED", "CONTEXT_READY"].includes(mission.status) ||
        !mission.execution
      ) {
        abortMissionExecutionRuns(
          change.missionId,
          `Mission entered ${mission.status}`,
        );
      }
    } catch {
      abortMissionExecutionRuns(
        change.missionId,
        "Mission history became unavailable",
      );
    }
  });

  function getMission(missionId) {
    const events = normalizeEventHistory(eventStore.load(missionId));
    if (events.length === 0) {
      throw new Error(`Mission not found: ${missionId}.`);
    }
    return projectMission(events, missionId);
  }

  function appendAgentEvent(
    missionId,
    {
      type,
      actor,
      reason,
      occurredAt = clock(),
      evidenceRefs = [],
      data,
      assertMission,
    },
  ) {
    const mission = getMission(missionId);
    assertAuditMetadata({ actor, reason });
    assertMission?.(mission);
    const event = {
      schemaVersion: EVENT_SCHEMA_VERSION,
      id: createId("event"),
      missionId,
      sequence: mission.events.length + 1,
      type,
      actor,
      occurredAt,
      reason,
      contextPackVersion: mission.contextPackVersion,
      evidenceRefs: clone(evidenceRefs),
      data: clone(data),
    };
    projectMission([...mission.events, event], missionId);
    eventStore.append(missionId, [event], {
      expectedSequence: mission.events.length,
    });
    return getMission(missionId);
  }

  function runFromObservation(mission, observation) {
    const existingRun = mission.run;
    if (observation.type === "RUN_STARTED") {
      return {
        id: observation.runId,
        status: "WORKING",
        startedAt: observation.occurredAt,
        updatedAt: observation.occurredAt,
        summary: null,
        modelMetadata: clone(observation.modelMetadata ?? null),
        evidence: [],
      };
    }
    if (!existingRun || observation.runId !== existingRun.id) {
      throw new Error("Agent observation does not match the active Run.");
    }
    if (observation.type === "RUN_UPDATED") {
      return {
        ...clone(existingRun),
        status: "WORKING",
        updatedAt: observation.occurredAt,
        summary: observation.summary,
      };
    }
    if (observation.type === "RUN_COMPLETED") {
      return {
        ...clone(existingRun),
        status: "COMPLETED",
        updatedAt: observation.occurredAt,
        summary: observation.summary,
        evidence: clone(observation.evidence),
      };
    }
    if (observation.type === "RUN_BLOCKED") {
      return {
        ...clone(existingRun),
        status: "BLOCKED",
        updatedAt: observation.occurredAt,
        blocker: observation.blocker,
        attemptedAlternatives: clone(observation.attemptedAlternatives),
        requiredAuthorityOrInput: observation.requiredAuthorityOrInput,
      };
    }
    throw new Error(`Unsupported agent observation: ${observation.type}.`);
  }

  async function consumeAgentRun(missionId, routing) {
    try {
      for await (const observation of agentRouter.run(routing)) {
        await writeCoordinator.runExclusive(() => {
          const mission = getMission(missionId);
          if (!["PLANNED", "RUNNING"].includes(mission.status)) {
            throw new Error(
              `Agent observation cannot be recorded while Mission is ${mission.status}.`,
            );
          }
          const run = runFromObservation(mission, observation);
          const eventType =
            AGENT_EVENT_TYPE_BY_OBSERVATION[observation.type];
          if (!eventType) {
            throw new Error(
              `Unsupported agent observation: ${observation.type}.`,
            );
          }
          const eventReason =
            observation.summary ??
            observation.blocker ??
            `Started Assignment ${routing.assignment.id}`;
          const evidenceRefs =
            observation.type === "RUN_COMPLETED"
              ? observation.evidence.map((item) => item.ref)
              : [];
          const appended = appendAgentEvent(missionId, {
            type: eventType,
            actor: `agent:${routing.agent.roleId}`,
            reason: eventReason,
            occurredAt: observation.occurredAt,
            evidenceRefs,
            data: {
              run,
              ...(observation.type === "RUN_COMPLETED"
                ? { artifacts: observation.artifacts }
                : {}),
            },
          });
          return appended;
        });
        if (["RUN_COMPLETED", "RUN_BLOCKED"].includes(observation.type)) {
          break;
        }
      }
    } catch (error) {
      await writeCoordinator.runExclusive(() => {
        const mission = getMission(missionId);
        if (!["PLANNED", "RUNNING"].includes(mission.status)) {
          throw error;
        }
        const run = {
          ...(mission.run ? clone(mission.run) : {}),
          id: mission.run?.id ?? `unavailable:${routing.assignment.id}`,
          status: "ERROR",
          updatedAt: clock(),
          error: error.message,
        };
        return appendAgentEvent(missionId, {
          type: "AGENT_RUN_ERROR",
          actor: "agent-router",
          reason: error.message,
          data: { run },
        });
      });
      throw error;
    }

    const mission = getMission(missionId);
    if (!["COMPLETED", "BLOCKED"].includes(mission.run?.status)) {
      const error = new Error(
        "Agent transport ended without a completed or blocked Run outcome.",
      );
      if (["PLANNED", "RUNNING"].includes(mission.status)) {
        await writeCoordinator.runExclusive(() =>
          appendAgentEvent(missionId, {
            type: "AGENT_RUN_ERROR",
            actor: "agent-router",
            reason: error.message,
            data: {
              run: {
                ...(mission.run ? clone(mission.run) : {}),
                id:
                  mission.run?.id ??
                  `unavailable:${routing.assignment.id}`,
                status: "ERROR",
                updatedAt: clock(),
                error: error.message,
              },
            },
          }),
        );
      }
      throw error;
    }
    return mission;
  }

  async function consumeExecutionRunWithSignal(
    missionId,
    waveId,
    attempt,
    routing,
    signal,
  ) {
    const missionAtDispatch = getMission(missionId);
    const nodeAtDispatch = missionAtDispatch.execution?.nodes.find(
      (node) => node.assignment.id === routing.assignment.id,
    );
    if (
      missionAtDispatch.status !== "RUNNING" ||
      !nodeAtDispatch ||
      !["ASSIGNED", "WORKING"].includes(nodeAtDispatch.status) ||
      nodeAtDispatch.currentWaveId !== waveId ||
      nodeAtDispatch.attempt !== attempt
    ) {
      return missionAtDispatch;
    }
    const reviewContext =
      routing.assignment.workKind === "review"
        ? {
            candidateArtifactRefs: (missionAtDispatch.artifacts ?? [])
              .map(artifactReference)
              .filter(Boolean),
          }
        : null;
    const decisionRoom = missionAtDispatch.execution?.decisionRooms.find(
      (room) =>
        room.status === "RESOLVED" &&
        room.assignmentId === routing.assignment.id &&
        room.assignmentAttempt === attempt,
    );
    const decisionContext = decisionRoom
      ? {
          roomId: decisionRoom.id,
          assignmentAttempt: decisionRoom.assignmentAttempt,
          decisionArtifact: clone(decisionRoom.decisionArtifact),
        }
      : null;
    try {
      for await (const observation of agentRouter.run(routing, {
        signal,
        ...(reviewContext ? { reviewContext } : {}),
        ...(decisionContext ? { decisionContext } : {}),
      })) {
        await writeCoordinator.runExclusive(() => {
          const mission = getMission(missionId);
          const node = mission.execution?.nodes.find(
            (candidate) => candidate.assignment.id === routing.assignment.id,
          );
          if (!node || mission.status !== "RUNNING") {
            throw new Error(
              `Execution observation cannot be recorded for Assignment ${routing.assignment.id} while Mission is ${mission.status}.`,
            );
          }
          const run = runFromObservation({ run: node.run }, observation);
          const eventType =
            EXECUTION_EVENT_TYPE_BY_OBSERVATION[observation.type];
          if (!eventType) {
            throw new Error(
              `Unsupported execution observation: ${observation.type}.`,
            );
          }
          const reason =
            observation.summary ??
            observation.blocker ??
            `Started Assignment ${routing.assignment.id}`;
          const evidenceRefs =
            observation.type === "RUN_COMPLETED"
              ? observation.evidence.map((item) => item.ref)
              : [];
          return appendAgentEvent(missionId, {
            type: eventType,
            actor: `agent:${routing.agent.roleId}`,
            reason,
            occurredAt: observation.occurredAt,
            evidenceRefs,
            data: {
              assignmentId: routing.assignment.id,
              waveId,
              attempt,
              run,
              ...(observation.type === "RUN_COMPLETED"
                ? { artifacts: observation.artifacts }
                : {}),
            },
          });
        });
        if (["RUN_COMPLETED", "RUN_BLOCKED"].includes(observation.type)) {
          break;
        }
      }
    } catch (error) {
      let interruptionHandled = false;
      await writeCoordinator.runExclusive(() => {
        const mission = getMission(missionId);
        const node = mission.execution?.nodes.find(
          (candidate) => candidate.assignment.id === routing.assignment.id,
        );
        if (
          !mission.execution ||
          !node ||
          ["BLOCKED", "CANCELLED", "CONTEXT_READY"].includes(mission.status) ||
          ["INTERRUPTED", "CANCELLED"].includes(node.status) ||
          node.currentWaveId !== waveId ||
          node.attempt !== attempt
        ) {
          interruptionHandled = true;
          return mission;
        }
        if (
          !["ASSIGNED", "WORKING"].includes(node.status)
        ) {
          throw error;
        }
        return appendAgentEvent(missionId, {
          type: "EXECUTION_RUN_ERROR",
          actor: "agent-router",
          reason: error.message,
          data: {
            assignmentId: routing.assignment.id,
            waveId,
            attempt,
            run: {
              ...(node.run ? clone(node.run) : {}),
              id: node.run?.id ?? `unavailable:${routing.assignment.id}`,
              status: "ERROR",
              updatedAt: clock(),
              error: error.message,
            },
          },
        });
      });
      if (interruptionHandled) {
        return getMission(missionId);
      }
      throw error;
    }

    const mission = getMission(missionId);
    const node = mission.execution?.nodes.find(
      (candidate) => candidate.assignment.id === routing.assignment.id,
    );
    if (
      !mission.execution ||
      !node ||
      ["BLOCKED", "CANCELLED", "CONTEXT_READY"].includes(mission.status) ||
      ["INTERRUPTED", "CANCELLED"].includes(node.status) ||
      node.currentWaveId !== waveId ||
      node.attempt !== attempt
    ) {
      return mission;
    }
    if (!["COMPLETED", "BLOCKED"].includes(node.status)) {
      const error = new Error(
        `Agent transport ended without a terminal outcome for Assignment ${routing.assignment.id}.`,
      );
      await writeCoordinator.runExclusive(() =>
        appendAgentEvent(missionId, {
          type: "EXECUTION_RUN_ERROR",
          actor: "agent-router",
          reason: error.message,
          data: {
            assignmentId: routing.assignment.id,
            waveId,
            attempt,
            run: {
              ...(node.run ? clone(node.run) : {}),
              id: node.run?.id ?? `unavailable:${routing.assignment.id}`,
              status: "ERROR",
              updatedAt: clock(),
              error: error.message,
            },
          },
        }),
      );
      throw error;
    }
    return mission;
  }

  async function consumeExecutionRun(missionId, waveId, attempt, routing) {
    const key = executionRunKey(
      missionId,
      waveId,
      routing.assignment.id,
      attempt,
    );
    const controller = new AbortController();
    activeExecutionRunControllers.set(key, controller);
    try {
      return await consumeExecutionRunWithSignal(
        missionId,
        waveId,
        attempt,
        routing,
        controller.signal,
      );
    } finally {
      try {
        await writeCoordinator.runExclusive(() => {
          const mission = getMission(missionId);
          const alreadyReleased = mission.events.some(
            (event) => {
              if (!EXECUTION_TRANSPORT_RELEASE_EVENT_TYPES.has(event.type)) {
                return false;
              }
              const releaseDetails =
                event.type === "EXECUTION_TRANSPORT_RECOVERED"
                  ? event.data?.recovery
                  : event.data;
              return (
                releaseDetails?.waveId === waveId &&
                releaseDetails?.assignmentId === routing.assignment.id
              );
            },
          );
          if (alreadyReleased) return mission;
          return appendAgentEvent(missionId, {
            type: "EXECUTION_TRANSPORT_SETTLED",
            actor: "agent-router",
            reason: `Transport settled for Assignment ${routing.assignment.id}`,
            data: {
              assignmentId: routing.assignment.id,
              waveId,
              attempt,
            },
          });
        });
      } finally {
        activeExecutionRunControllers.delete(key);
      }
    }
  }

  function activeTrackedTransportReservations(missionId, mission) {
    return getOpenExecutionTransportReservations(mission).map(
      (reservation) => ({
        missionId,
        assignment: clone(reservation.assignment),
        coordinationRequired: reservation.coordinationRequired,
      }),
    );
  }

  function buildGlobalExecutionPlanningContext(missionId, mission) {
    const missions = eventStore.listMissionIds().map((candidateId) => ({
      id: candidateId,
      mission: getMission(candidateId),
    }));
    const activeAssignments = [];
    let coordinationRequired = false;

    for (const candidate of missions) {
      const trackedReservations = activeTrackedTransportReservations(
        candidate.id,
        candidate.mission,
      );
      const trackedAssignmentIds = new Set(
        trackedReservations.map(
          (reservation) => reservation.assignment.id,
        ),
      );
      activeAssignments.push(...trackedReservations);
      coordinationRequired ||=
        trackedReservations.some(
          (reservation) => reservation.coordinationRequired,
        );
      if (candidate.mission.execution) {
        const executionIsCoordinating =
          candidate.mission.execution.activeAssignmentIds.length > 0 ||
          ["PLANNED", "RUNNING", "CHANGES_REQUESTED"].includes(
            candidate.mission.status,
          );
        coordinationRequired ||=
          executionIsCoordinating &&
          candidate.mission.execution.coordinationRequired;
        for (const node of candidate.mission.execution.nodes) {
          if (
            ["ASSIGNED", "WORKING"].includes(node.status) &&
            !trackedAssignmentIds.has(node.assignment.id)
          ) {
            activeAssignments.push({
              missionId: candidate.id,
              assignment: clone(node.assignment),
            });
          }
        }
        continue;
      }
      if (
        candidate.mission.assignment &&
        (candidate.mission.status === "PLANNED" ||
          ["ASSIGNED", "WORKING"].includes(
            candidate.mission.run?.status,
          ))
      ) {
        activeAssignments.push({
          missionId: candidate.id,
          assignment: clone(candidate.mission.assignment),
        });
      }
    }

    const globalReservedSlots = coordinationRequired ? 1 : 0;
    const globalWorkerCapacity =
      GLOBAL_AGENT_CAPACITY - globalReservedSlots;
    const globalActiveWorkerCount = activeAssignments.length;
    const globalAvailableWorkerSlots = Math.max(
      0,
      globalWorkerCapacity - globalActiveWorkerCount,
    );
    const locallyProjectedActiveIds = new Set(
      mission.execution?.activeAssignmentIds ?? [],
    );
    const concurrentAssignments = activeAssignments
      .filter(
        (active) =>
          active.missionId !== missionId ||
          !locallyProjectedActiveIds.has(active.assignment.id),
      )
      .map((active) => active.assignment);

    return {
      globalCapacity: GLOBAL_AGENT_CAPACITY,
      globalReservedSlots,
      globalWorkerCapacity,
      globalActiveWorkerCount,
      globalAvailableWorkerSlots,
      concurrentAssignments,
    };
  }

  return {
    createMission(input) {
      return writeCoordinator.runExclusive(() => {
        const { brief, actor, reason } = input;
        assertValidBrief(brief);
        assertAuditMetadata({ actor, reason });

        const missionId = createId("mission");
        const event = {
          schemaVersion: EVENT_SCHEMA_VERSION,
          id: createId("event"),
          missionId,
          sequence: 1,
          type: "MISSION_CREATED",
          actor,
          occurredAt: clock(),
          reason,
          contextPackVersion: 1,
          evidenceRefs: [],
          data: { brief: clone(brief) },
        };

        eventStore.append(missionId, [event], { expectedSequence: 0 });
        return getMission(missionId);
      });
    },
    listMissions() {
      return eventStore
        .listMissionIds()
        .map((missionId) => getMission(missionId));
    },
    getMission,
    async dispatchExecutionWave(missionId, input) {
      if (!agentRouter) {
        throw new Error("Agent routing is not connected.");
      }
      const { actor, reason } = input;
      assertAuditMetadata({ actor, reason });

      const prepared = await writeCoordinator.runExclusive(() => {
        const mission = getMission(missionId);
        if (!mission.execution) {
          throw new Error("Execution wave requires an accepted Task Graph.");
        }
        if (!mission.allowedActions.includes("dispatch_execution_wave")) {
          throw new Error(
            `Execution wave dispatch is not allowed while Mission is ${mission.status}.`,
          );
        }
        const planningContext = buildGlobalExecutionPlanningContext(
          missionId,
          mission,
        );
        const wavePlan = planTaskExecutionWave(mission.execution, {
          availableWorkerSlots:
            planningContext.globalAvailableWorkerSlots,
          concurrentAssignments: planningContext.concurrentAssignments,
        });
        if (wavePlan.assignmentIds.length === 0) {
          if (planningContext.globalAvailableWorkerSlots === 0) {
            throw new Error(
              "No global worker slot is available for this execution wave.",
            );
          }
          throw new Error("No safe Assignment is available for this wave.");
        }
        const routings = wavePlan.assignmentIds.map((assignmentId) => {
          const node = mission.execution.nodes.find(
            (candidate) => candidate.assignment.id === assignmentId,
          );
          const routing = agentRouter.route(node.assignment);
          assertAssignmentWithinMissionAuthority(mission, routing);
          return routing;
        });
        const wave = {
          id: createId("wave"),
          ...wavePlan,
        };
        const transportReservationAttempts = Object.fromEntries(
          routings.map((routing) => {
            const node = mission.execution.nodes.find(
              (candidate) => candidate.assignment.id === routing.assignment.id,
            );
            return [routing.assignment.id, node.attempt + 1];
          }),
        );
        const dispatched = appendAgentEvent(missionId, {
          type: "EXECUTION_WAVE_DISPATCHED",
          actor,
          reason,
          data: {
            wave,
            routings,
            planningContext,
            transportReservationsTracked: true,
            transportReservationAttempts,
          },
        });
        const attempts = routings.map((routing) =>
          dispatched.execution.nodes.find(
            (node) => node.assignment.id === routing.assignment.id,
          ).attempt,
        );
        return { wave, routings, attempts };
      });

      const results = await Promise.allSettled(
        prepared.routings.map((routing, index) =>
          consumeExecutionRun(
            missionId,
            prepared.wave.id,
            prepared.attempts[index],
            routing,
          ),
        ),
      );
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          `${failures.length} execution-wave Assignment(s) failed.`,
        );
      }
      return getMission(missionId);
    },
    async dispatchAssignment(missionId, input) {
      if (!agentRouter) {
        throw new Error("Agent routing is not connected.");
      }
      const { assignment, actor, reason } = input;
      assertAuditMetadata({ actor, reason });
      const routing = agentRouter.route(assignment);

      await writeCoordinator.runExclusive(() =>
        appendAgentEvent(missionId, {
          type: "ASSIGNMENT_ROUTED",
          actor,
          reason,
          data: {
            assignment: routing.assignment,
            agent: routing.agent,
          },
          assertMission(mission) {
            if (mission.execution) {
              throw new Error(
                "A legacy Assignment dispatch is unavailable for a Task Graph Mission.",
              );
            }
            if (mission.status !== "PLANNED") {
              throw new Error(
                `Assignment routing is not allowed while Mission is ${mission.status}.`,
              );
            }
            if (mission.assignment) {
              throw new Error(
                `Mission already has Assignment ${mission.assignment.id}.`,
              );
            }
            assertAssignmentWithinMissionAuthority(mission, routing);
            const planningContext = buildGlobalExecutionPlanningContext(
              missionId,
              mission,
            );
            if (planningContext.globalAvailableWorkerSlots === 0) {
              throw new Error(
                "No global worker slot is available for this Assignment.",
              );
            }
            if (
              planningContext.concurrentAssignments.some((concurrent) =>
                writableAssignmentsOverlap(routing.assignment, concurrent),
              )
            ) {
              throw new Error(
                "Legacy Assignment writable ownership overlaps active writable ownership.",
              );
            }
          },
        }),
      );

      return consumeAgentRun(missionId, routing);
    },
    async dispatchCorrection(missionId, input) {
      if (!agentRouter) {
        throw new Error("Agent routing is not connected.");
      }
      const { actor, reason } = input;
      assertAuditMetadata({ actor, reason });
      const routing = await writeCoordinator.runExclusive(() => {
        const mission = getMission(missionId);
        if (mission.execution) {
          throw new Error(
            "A legacy correction dispatch is unavailable for a Task Graph Mission.",
          );
        }
        if (!mission.assignment || !mission.agent) {
          throw new Error(
            "A connected correction requires the existing assigned agent.",
          );
        }
        const interruptedAssignedRun =
          mission.status === "RUNNING" &&
          ["INTERRUPTED", "BLOCKED", "ERROR"].includes(
            mission.run?.status,
          );
        if (
          !(
            mission.status === "CHANGES_REQUESTED" ||
            interruptedAssignedRun
          )
        ) {
          throw new Error(
            `Correction dispatch is not allowed while Mission is ${mission.status}.`,
          );
        }
        const nextRouting = agentRouter.route(mission.assignment);
        if (nextRouting.agent.roleId !== mission.agent.roleId) {
          throw new Error(
            `Correction routing changed assigned role from ${mission.agent.roleId} to ${nextRouting.agent.roleId}.`,
          );
        }
        assertAssignmentWithinMissionAuthority(mission, nextRouting);
        const planningContext = buildGlobalExecutionPlanningContext(
          missionId,
          mission,
        );
        if (planningContext.globalAvailableWorkerSlots === 0) {
          throw new Error(
            "No global worker slot is available for this correction.",
          );
        }
        if (
          planningContext.concurrentAssignments.some((concurrent) =>
            writableAssignmentsOverlap(nextRouting.assignment, concurrent),
          )
        ) {
          throw new Error(
            "Legacy correction writable ownership overlaps active writable ownership.",
          );
        }
        appendAgentEvent(missionId, {
          type: "CORRECTION_DISPATCHED",
          actor,
          reason,
          data: {
            run: {
              id: `reserved:${nextRouting.assignment.id}:${mission.events.length + 1}`,
              status: "ASSIGNED",
              updatedAt: clock(),
              agentRole: nextRouting.agent.roleId,
            },
          },
        });
        return nextRouting;
      });
      return consumeAgentRun(missionId, routing);
    },
    execute(missionId, input) {
      return writeCoordinator.runExclusive(() => {
        const {
          type,
          payload = {},
          actor,
          reason,
          evidenceRefs = [],
        } = input;
        const mission = getMission(missionId);
        const command =
          COMMANDS[type] ?? CORRECTION_COMMANDS[type] ?? EXECUTION_COMMANDS[type];

        if (!command) {
          throw new Error(`Unknown command: ${type}.`);
        }
        assertAuditMetadata({ actor, reason });
        if (
          mission.execution &&
          ["START_RUN", "SUBMIT_ARTIFACT", "START_CORRECTION"].includes(type)
        ) {
          throw new Error(
            "Legacy Run commands are unavailable for a Task Graph Mission.",
          );
        }
        const allowedFrom = Array.isArray(command.from)
          ? command.from
          : [command.from];
        if (!allowedFrom.includes(mission.status)) {
          throw new Error(
            `${type} is not allowed while Mission is ${mission.status}.`,
          );
        }
        if (
          !payload ||
          payload[command.field] === null ||
          typeof payload[command.field] !== "object"
        ) {
          throw new Error(`${type} requires ${command.field}.`);
        }
        if (
          command.requiresEvidence &&
          (!Array.isArray(evidenceRefs) ||
            evidenceRefs.length === 0 ||
            evidenceRefs.some(
              (reference) =>
                typeof reference !== "string" || reference.trim() === "",
            ))
        ) {
          throw new Error(`${type} requires at least one Evidence reference.`);
        }
        if (type === "COMPLETE_NO_RELEASE" && mission.brief.releaseRequired) {
          throw new Error("A release-required Mission cannot complete locally.");
        }
        if (type === "BLOCK_MISSION") {
          assertBlockDetails(payload.block, "BLOCK_MISSION");
        }
        if (type === "RECOVER_EXECUTION_TRANSPORT") {
          assertTransportRecoveryDetails(
            payload.recovery,
            "RECOVER_EXECUTION_TRANSPORT",
          );
        }
        if (
          type === "START_CORRECTION" &&
          mission.agent &&
          payload.run.agentRole !== mission.agent.roleId
        ) {
          throw new Error(
            `START_CORRECTION must return work to assigned role ${mission.agent.roleId}.`,
          );
        }
        if (
          type === "START_CORRECTION" &&
          mission.status === "RUNNING" &&
          !(
            mission.assignment &&
            ["INTERRUPTED", "BLOCKED", "ERROR"].includes(
              mission.run?.status,
            )
          )
        ) {
          throw new Error(
            "START_CORRECTION requires requested changes or an interrupted assigned Run.",
          );
        }
        if (
          type === "RESUME_MISSION" &&
          (typeof payload.resumption.summary !== "string" ||
            payload.resumption.summary.trim() === "")
        ) {
          throw new Error("RESUME_MISSION requires a resumption summary.");
        }
        if (
          type === "CANCEL_MISSION" &&
          (typeof payload.cancellation.summary !== "string" ||
            payload.cancellation.summary.trim() === "")
        ) {
          throw new Error("CANCEL_MISSION requires a cancellation summary.");
        }
        if (type === "SUBMIT_ARTIFACT") {
          const reference = artifactReference(payload.artifact);
          if (!reference) {
            throw new Error(
              "SUBMIT_ARTIFACT requires an Artifact reference (uri, path, ref, or id).",
            );
          }
          if (mission.invalidatedArtifactRefs?.includes(reference)) {
            throw new Error(
              "SUBMIT_ARTIFACT requires a regenerated Artifact reference.",
            );
          }
        }
        if (
          command.requiresEvidence &&
          evidenceRefs.some((reference) =>
            mission.invalidatedEvidenceRefs?.includes(reference),
          )
        ) {
          throw new Error(`${type} requires current Evidence.`);
        }
        let eventPayload = payload;
        if (["APPROVE_RELEASE", "REJECT_RELEASE"].includes(type)) {
          const decision =
            type === "APPROVE_RELEASE" ? "APPROVED" : "REJECTED";
          eventPayload = {
            approval: buildApprovalSnapshot(
              mission,
              decision,
              payload.approval.summary,
            ),
          };
          assertCurrentReleaseDecision(
            mission,
            {
              actor,
              evidenceRefs,
              approval: eventPayload.approval,
            },
            decision,
            type,
          );
        }

        const event = {
          schemaVersion: EVENT_SCHEMA_VERSION,
          id: createId("event"),
          missionId,
          sequence: mission.events.length + 1,
          type: command.eventType,
          actor,
          occurredAt: clock(),
          reason,
          contextPackVersion:
            type === "REVISE_CONTEXT"
              ? mission.contextPackVersion + 1
              : mission.contextPackVersion,
          evidenceRefs: clone(evidenceRefs),
          data: clone(eventPayload),
        };
        projectMission([...mission.events, event], missionId);
        eventStore.append(missionId, [event], {
          expectedSequence: mission.events.length,
        });
        const updated = getMission(missionId);
        if (["BLOCK_MISSION", "CANCEL_MISSION", "REVISE_CONTEXT"].includes(type)) {
          abortMissionExecutionRuns(missionId, reason);
        }
        return updated;
      });
    },
  };
}
