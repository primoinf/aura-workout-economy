import { MISSION_STATUS_ORDER } from "./mission-orchestrator.js";

export const LIFECYCLE_LABELS = Object.freeze({
  BRIEF_ACCEPTED: "Brief",
  CONTEXT_READY: "Context",
  PLANNED: "Plan",
  RUNNING: "Run",
  IN_REVIEW: "Review",
  VALIDATING: "Validation",
  APPROVAL_REQUIRED: "Approval",
  READY_TO_RELEASE: "Release ready",
  LEARNING: "Learning",
  READY_TO_COMPLETE: "Accept",
  COMPLETED: "Complete",
  CHANGES_REQUESTED: "Changes requested",
  BLOCKED: "Blocked",
  CANCELLED: "Cancelled",
});

export const TEAM_ROLE_DIRECTORY = Object.freeze([
  Object.freeze({
    id: "orchestrator",
    initials: "OR",
    name: "Orchestrator",
    role: "Team Lead",
    capability: "Mission sequencing and gate control",
    permission: "Coordinates only",
    tone: "cyan",
  }),
  Object.freeze({
    id: "luna_worker",
    initials: "LU",
    name: "Luna Worker",
    role: "Operations",
    capability: "Deterministic search, extraction, and checks",
    permission: "Bounded worker",
    tone: "violet",
  }),
  Object.freeze({
    id: "terra_builder",
    initials: "TB",
    name: "Terra Builder",
    role: "Build Team",
    capability: "Well-scoped product implementation",
    permission: "Scoped write",
    tone: "emerald",
  }),
  Object.freeze({
    id: "terra_debugger",
    initials: "TD",
    name: "Terra Debugger",
    role: "Incident Team",
    capability: "Reproducible defects and subtle state",
    permission: "Scoped write",
    tone: "amber",
  }),
  Object.freeze({
    id: "sol_architect",
    initials: "SA",
    name: "Sol Architect",
    role: "Architecture Board",
    capability: "High-risk boundaries and system decisions",
    permission: "Decision support",
    tone: "blue",
  }),
  Object.freeze({
    id: "sol_reviewer",
    initials: "SR",
    name: "Sol Reviewer",
    role: "Quality Board",
    capability: "Independent correctness and security review",
    permission: "Read-only by default",
    tone: "rose",
  }),
]);

function lifecycleOrder(mission) {
  return mission.brief.releaseRequired
    ? MISSION_STATUS_ORDER
    : MISSION_STATUS_ORDER.filter(
        (status) =>
          !["APPROVAL_REQUIRED", "READY_TO_RELEASE"].includes(status),
      );
}

function lifecycleIndex(mission, status) {
  return lifecycleOrder(mission).indexOf(status);
}

function lifecycleCompletion(mission, status) {
  const order = lifecycleOrder(mission);
  const index = order.indexOf(status);
  return index < 0
    ? 0
    : Math.round(((index + 1) / order.length) * 100);
}

function correctionAnchorStatus(mission) {
  return (
    {
      REVIEW: "IN_REVIEW",
      VALIDATION: "VALIDATING",
      APPROVAL: "APPROVAL_REQUIRED",
    }[mission.changeRequest?.source ?? mission.lastChangeRequest?.source] ??
    "IN_REVIEW"
  );
}

function deriveControlState(mission) {
  const source =
    mission.changeRequest?.source ?? mission.lastChangeRequest?.source ?? null;
  const correctionAnchor = correctionAnchorStatus(mission);
  const anchorForStatus = (status) =>
    status === "CHANGES_REQUESTED" ? correctionAnchor : status;
  if (mission.events.at(-1)?.type === "MISSION_RESUMED") {
    return Object.freeze({
      anchorStatus: anchorForStatus(mission.status),
      kind: "resumed",
      label: "Resumed",
      summary: mission.resume.summary,
      source,
      priorSafeState: mission.resume.toStatus,
    });
  }
  if (mission.status === "CHANGES_REQUESTED") {
    return Object.freeze({
      anchorStatus: correctionAnchor,
      kind: "changes-requested",
      label: "Changes requested",
      summary: mission.changeRequest.reason,
      source,
      priorSafeState: correctionAnchor,
    });
  }
  if (mission.status === "BLOCKED") {
    return Object.freeze({
      anchorStatus: anchorForStatus(mission.blockedFrom),
      kind: "blocked",
      label: "Blocked",
      summary: mission.block.blocker,
      source,
      priorSafeState: mission.blockedFrom,
    });
  }
  if (mission.status === "CANCELLED") {
    const priorSafeState =
      mission.cancelledFrom === "BLOCKED"
        ? mission.blockedFrom
        : mission.cancelledFrom;
    return Object.freeze({
      anchorStatus: anchorForStatus(priorSafeState),
      kind: "cancelled",
      label: "Cancelled",
      summary: mission.cancellation.summary,
      source,
      priorSafeState,
    });
  }
  if (mission.status === "COMPLETED") {
    return Object.freeze({
      anchorStatus: mission.status,
      kind: "completed",
      label: "Completed",
      summary: mission.completion?.summary ?? "Mission completed",
      source,
      priorSafeState: null,
    });
  }
  return Object.freeze({
    anchorStatus: mission.status,
    kind: "active",
    label: "Active",
    summary: mission.events.at(-1)?.reason ?? "Mission is active",
    source,
    priorSafeState: null,
  });
}

function latestEventTime(mission) {
  return mission.events.at(-1)?.occurredAt ?? "";
}

function toMissionSummary(mission) {
  const latestEvent = mission.events.at(-1);
  const controlState = deriveControlState(mission);
  return Object.freeze({
    id: mission.id,
    goal: mission.brief.goal,
    scope: mission.brief.scope,
    risk: mission.brief.risk,
    status: mission.status,
    lifecycleCompletion: lifecycleCompletion(
      mission,
      controlState.anchorStatus,
    ),
    eventCount: mission.events.length,
    latestEvent,
    nextAction: mission.allowedActions[0] ?? null,
  });
}

function elapsedTime(run) {
  if (!run?.startedAt || !run?.updatedAt) {
    return null;
  }
  const elapsedMilliseconds =
    Date.parse(run.updatedAt) - Date.parse(run.startedAt);
  if (!Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds < 0) {
    return null;
  }
  const elapsedMinutes = Math.floor(elapsedMilliseconds / 60_000);
  if (elapsedMinutes < 1) {
    return "<1m";
  }
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m`;
  }
  const hours = Math.floor(elapsedMinutes / 60);
  const minutes = elapsedMinutes % 60;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function runtimeLabel(status) {
  return (
    {
      ASSIGNED: "Assigned",
      WORKING: "Working",
      COMPLETED: "Completed",
      BLOCKED: "Blocked",
      ERROR: "Error",
    }[status] ?? status
  );
}

function deriveTeamModel(missions) {
  const latestObservationByRole = new Map();
  const orderedMissions = [...missions].sort((left, right) =>
    latestEventTime(right).localeCompare(latestEventTime(left)),
  );
  for (const mission of orderedMissions) {
    const roleId = mission.agent?.roleId;
    if (roleId && !latestObservationByRole.has(roleId)) {
      latestObservationByRole.set(roleId, mission);
    }
  }

  return Object.freeze(
    TEAM_ROLE_DIRECTORY.map((role) => {
      const mission = latestObservationByRole.get(role.id);
      if (!mission) {
        return Object.freeze({
          ...role,
          connection: "Not connected",
          assignment: "No assignment",
          telemetry: "No runtime observation",
          runtimeStatus: "DISCONNECTED",
          effectivePermission: null,
          modelMetadata: null,
          elapsedTime: null,
          latestEvidence: null,
          missionId: null,
        });
      }

      const run = mission.run;
      const runtimeStatus = run?.status ?? "ASSIGNED";
      const elapsed = elapsedTime(run);
      const modelMetadata = run?.modelMetadata
        ? Object.freeze(structuredClone(run.modelMetadata))
        : null;
      const latestEvidence =
        run?.evidence?.at(-1)?.ref ??
        mission.events
          .flatMap((event) => event.evidenceRefs)
          .at(-1) ??
        null;
      return Object.freeze({
        ...role,
        connection: runtimeStatus === "ERROR" ? "Error" : "Observed",
        assignment: mission.assignment.goal,
        telemetry: `${runtimeLabel(runtimeStatus)}${elapsed ? ` · ${elapsed}` : ""}`,
        runtimeStatus,
        effectivePermission: mission.agent.effectivePermission,
        modelMetadata,
        elapsedTime: elapsed,
        latestEvidence,
        missionId: mission.id,
      });
    }),
  );
}

export function deriveCommandDeckModel(missions) {
  const orderedMissions = [...missions].sort((left, right) =>
    latestEventTime(right).localeCompare(latestEventTime(left)),
  );
  const completedMissions = orderedMissions.filter(
    (mission) => mission.status === "COMPLETED",
  ).length;
  const cancelledMissions = orderedMissions.filter(
    (mission) => mission.status === "CANCELLED",
  ).length;
  const latestSignals = orderedMissions
    .flatMap((mission) =>
      mission.events.map((event) => ({
        missionId: mission.id,
        missionGoal: mission.brief.goal,
        sequence: event.sequence,
        type: event.type,
        actor: event.actor,
        occurredAt: event.occurredAt,
        reason: event.reason,
        evidenceCount: event.evidenceRefs.length,
      })),
    )
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
    .slice(0, 5);

  return Object.freeze({
    metrics: Object.freeze({
      activeMissions:
        orderedMissions.length - completedMissions - cancelledMissions,
      completedMissions,
      cancelledMissions,
      auditEvents: orderedMissions.reduce(
        (total, mission) => total + mission.events.length,
        0,
      ),
      configuredAgents: TEAM_ROLE_DIRECTORY.length,
      agentTelemetry: orderedMissions.some((mission) => mission.agent)
        ? "Observed"
        : "Unavailable",
    }),
    missions: Object.freeze(orderedMissions.map(toMissionSummary)),
    team: deriveTeamModel(orderedMissions),
    latestSignals: Object.freeze(latestSignals.map(Object.freeze)),
  });
}

export function deriveApprovalRoomModel(mission) {
  const releaseDecision = mission.releaseReadiness ?? mission.approval;
  if (!mission.brief.releaseRequired || !releaseDecision) {
    throw new Error(
      "Approval Room requires a release Mission with a current decision snapshot.",
    );
  }
  const decisionHistory = mission.events
    .filter((event) =>
      ["RELEASE_APPROVED", "RELEASE_REJECTED"].includes(event.type),
    )
    .map((event) =>
      Object.freeze({
        sequence: event.sequence,
        type: event.type,
        actor: event.actor,
        reason: event.reason,
        occurredAt: event.occurredAt,
        decision: event.data.approval.decision,
        summary: event.data.approval.summary,
        evidenceRefs: Object.freeze([...event.evidenceRefs]),
      }),
    );
  const externalActionExecuted = mission.events.some((event) =>
    [
      "RELEASED",
      "DEPLOYED",
      "COMMITTED",
      "PUSHED",
      "PULL_REQUEST_OPENED",
    ].includes(event.type),
  );

  return Object.freeze({
    missionId: mission.id,
    goal: mission.brief.goal,
    status: mission.status,
    candidate: Object.freeze(structuredClone(releaseDecision.candidate)),
    candidateArtifacts: Object.freeze(
      structuredClone(releaseDecision.candidateArtifacts),
    ),
    contextPackVersion: releaseDecision.contextPackVersion,
    evidence: Object.freeze([...releaseDecision.evidenceRefs]),
    residualRisk: releaseDecision.residualRisk,
    intendedExternalAction: releaseDecision.intendedExternalAction,
    rollbackCommitment: releaseDecision.rollbackCommitment,
    releaseAuthority: mission.brief.releaseAuthority,
    canApprove: mission.allowedActions.includes("approve_release"),
    canReject: mission.allowedActions.includes("reject_release"),
    decisionHistory: Object.freeze(decisionHistory),
    externalActionExecuted,
  });
}

export function deriveMissionFlowModel(mission) {
  const controlState = deriveControlState(mission);
  const order = lifecycleOrder(mission);
  const currentIndex = lifecycleIndex(mission, controlState.anchorStatus);
  const { anchorStatus: _anchorStatus, ...visualStateData } = controlState;
  const visualState = Object.freeze(visualStateData);
  const evidenceRefs = new Set(
    mission.events.flatMap((event) => event.evidenceRefs),
  );
  const stages = order.map((status, index) =>
    Object.freeze({
      status,
      label: LIFECYCLE_LABELS[status],
      index,
      number: index + 1,
      state:
        index < currentIndex
          ? "done"
          : index === currentIndex
            ? visualState.kind === "active" ||
              visualState.kind === "completed"
              ? "current"
              : visualState.kind
            : "locked",
    }),
  );

  return Object.freeze({
    mission,
    lifecycleCompletion: lifecycleCompletion(
      mission,
      controlState.anchorStatus,
    ),
    visualState,
    currentStage: Object.freeze({
      status: mission.status,
      label:
        visualState.kind === "active" || visualState.kind === "completed"
          ? (LIFECYCLE_LABELS[mission.status] ?? mission.status)
          : visualState.label,
      position: currentIndex + 1,
      total: order.length,
    }),
    nextAction: mission.allowedActions[0] ?? null,
    evidenceCount: evidenceRefs.size,
    stages: Object.freeze(stages),
    team: deriveTeamModel([mission]),
  });
}
