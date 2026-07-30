import { MISSION_STATUS_ORDER } from "./mission-orchestrator.js";

export const LIFECYCLE_LABELS = Object.freeze({
  BRIEF_ACCEPTED: "Brief",
  CONTEXT_READY: "Context",
  PLANNED: "Plan",
  RUNNING: "Run",
  IN_REVIEW: "Review",
  VALIDATING: "Validation",
  LEARNING: "Learning",
  READY_TO_COMPLETE: "Accept",
  COMPLETED: "Complete",
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

function lifecycleIndex(status) {
  return MISSION_STATUS_ORDER.indexOf(status);
}

function lifecycleCompletion(status) {
  const index = lifecycleIndex(status);
  return index < 0
    ? 0
    : Math.round(((index + 1) / MISSION_STATUS_ORDER.length) * 100);
}

function latestEventTime(mission) {
  return mission.events.at(-1)?.occurredAt ?? "";
}

function toMissionSummary(mission) {
  const latestEvent = mission.events.at(-1);
  return Object.freeze({
    id: mission.id,
    goal: mission.brief.goal,
    scope: mission.brief.scope,
    risk: mission.brief.risk,
    status: mission.status,
    lifecycleCompletion: lifecycleCompletion(mission.status),
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
      activeMissions: orderedMissions.length - completedMissions,
      completedMissions,
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

export function deriveMissionFlowModel(mission) {
  const currentIndex = lifecycleIndex(mission.status);
  const evidenceRefs = new Set(
    mission.events.flatMap((event) => event.evidenceRefs),
  );
  const stages = MISSION_STATUS_ORDER.map((status, index) =>
    Object.freeze({
      status,
      label: LIFECYCLE_LABELS[status],
      index,
      number: index + 1,
      state:
        index < currentIndex
          ? "done"
          : index === currentIndex
            ? "current"
            : "locked",
    }),
  );

  return Object.freeze({
    mission,
    lifecycleCompletion: lifecycleCompletion(mission.status),
    currentStage: Object.freeze({
      status: mission.status,
      label: LIFECYCLE_LABELS[mission.status] ?? mission.status,
      position: currentIndex + 1,
      total: MISSION_STATUS_ORDER.length,
    }),
    nextAction: mission.allowedActions[0] ?? null,
    evidenceCount: evidenceRefs.size,
    stages: Object.freeze(stages),
    team: deriveTeamModel([mission]),
  });
}
