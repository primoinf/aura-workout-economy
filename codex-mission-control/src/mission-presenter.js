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

function latestAssignmentEvent(mission, assignmentId) {
  return [...mission.events]
    .reverse()
    .find(
      (event) =>
        event.data?.assignmentId === assignmentId ||
        event.data?.wave?.assignmentIds?.includes(assignmentId),
    );
}

function runtimeObservationsForMission(mission) {
  const executionObservations = (mission.execution?.nodes ?? [])
    .filter((node) => node.agent)
    .map((node) => {
      const latestEvent = latestAssignmentEvent(mission, node.assignment.id);
      const waveEvent = [...mission.events]
        .reverse()
        .find((event) =>
          event.data?.wave?.assignmentIds?.includes(node.assignment.id),
        );
      return {
        mission,
        assignment: node.assignment,
        agent: node.agent,
        run: node.run,
        evidenceRefs: node.evidenceRefs,
        observedAt: latestEvent?.occurredAt ?? latestEventTime(mission),
        queueOrder:
          (waveEvent?.sequence ?? 0) * 1_000 +
          Math.max(
            0,
            waveEvent?.data?.wave?.assignmentIds?.indexOf(node.assignment.id) ??
              0,
          ),
      };
    });
  if (executionObservations.length > 0) {
    return executionObservations;
  }
  return mission.agent
    ? [
        {
          mission,
          assignment: mission.assignment,
          agent: mission.agent,
          run: mission.run,
          evidenceRefs: mission.events.flatMap((event) => event.evidenceRefs),
          observedAt: latestEventTime(mission),
          queueOrder:
            mission.events.find((event) => event.type === "ASSIGNMENT_ROUTED")
              ?.sequence ?? 0,
        },
      ]
    : [];
}

function deriveConfiguredTeamModel() {
  return Object.freeze(
    TEAM_ROLE_DIRECTORY.map((role) =>
      Object.freeze({
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
        assignmentId: null,
        runId: null,
        queuePosition: null,
        cardId: `configured:${role.id}`,
      }),
    ),
  );
}

function deriveAgentCards(missions) {
  const observations = missions
    .flatMap(runtimeObservationsForMission)
    .sort(
      (left, right) =>
        left.queueOrder - right.queueOrder ||
        left.assignment.id.localeCompare(right.assignment.id),
    );
  const queuedObservations = observations.filter(
    (observation) => (observation.run?.status ?? "ASSIGNED") === "ASSIGNED",
  );
  const queuePositions = new Map(
    queuedObservations.map((observation, index) => [
      `${observation.mission.id}:${observation.assignment.id}`,
      index + 1,
    ]),
  );

  return Object.freeze(
    observations.map((observation) => {
      const { mission, assignment, agent, run, evidenceRefs } = observation;
      const role = TEAM_ROLE_DIRECTORY.find(
        (candidate) => candidate.id === agent.roleId,
      );
      if (!role) {
        throw new Error(`Unknown observed agent role: ${agent.roleId}.`);
      }
      const runtimeStatus = run?.status ?? "ASSIGNED";
      const elapsed = elapsedTime(run);
      const queuePosition =
        queuePositions.get(`${mission.id}:${assignment.id}`) ?? null;
      return Object.freeze({
        ...role,
        connection: runtimeStatus === "ERROR" ? "Error" : "Observed",
        assignment: assignment.goal,
        telemetry: [
          runtimeLabel(runtimeStatus),
          elapsed,
          queuePosition ? `Queue ${queuePosition}` : null,
        ]
          .filter(Boolean)
          .join(" · "),
        runtimeStatus,
        effectivePermission: agent.effectivePermission,
        modelMetadata: run?.modelMetadata
          ? Object.freeze(structuredClone(run.modelMetadata))
          : null,
        elapsedTime: elapsed,
        latestEvidence:
          run?.evidence?.at(-1)?.ref ?? evidenceRefs.at(-1) ?? null,
        missionId: mission.id,
        assignmentId: assignment.id,
        runId: run?.id ?? null,
        queuePosition,
        cardId: `${mission.id}:${assignment.id}:${run?.id ?? "assigned"}`,
      });
    }),
  );
}

function deriveTeamModel(configuredTeam, agentCards) {
  return Object.freeze(
    TEAM_ROLE_DIRECTORY.flatMap((role) => {
      const roleCards = agentCards.filter((card) => card.id === role.id);
      return roleCards.length > 0
        ? roleCards
        : [configuredTeam.find((card) => card.id === role.id)];
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
  const configuredTeam = deriveConfiguredTeamModel();
  const agentCards = deriveAgentCards(orderedMissions);

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
      agentTelemetry: orderedMissions.some(
        (mission) =>
          mission.agent ||
          mission.execution?.nodes.some((node) => Boolean(node.agent)),
      )
        ? "Observed"
        : "Unavailable",
    }),
    missions: Object.freeze(orderedMissions.map(toMissionSummary)),
    configuredTeam,
    agentCards,
    team: deriveTeamModel(configuredTeam, agentCards),
    latestSignals: Object.freeze(latestSignals.map(Object.freeze)),
  });
}

function evidenceDetailsForReference(mission, reference) {
  const sourceEvents = [...mission.events].reverse();
  const sourceEvent =
    sourceEvents.find(
      (event) =>
        event.evidenceRefs?.includes(reference) &&
        !["RELEASE_APPROVED", "RELEASE_REJECTED"].includes(event.type),
    ) ?? sourceEvents.find((event) => event.evidenceRefs?.includes(reference));
  const runEvidence = sourceEvent?.data?.run?.evidence?.find(
    (item) => item.ref === reference,
  );
  const sourceArtifact = sourceEvent?.data?.artifact;
  const sourcePayload =
    sourceEvent?.data?.review ??
    sourceEvent?.data?.validation ??
    sourceEvent?.data?.approval ??
    null;
  const payloadDetails = sourcePayload
    ? (() => {
        const { summary: _summary, details, ...remaining } = sourcePayload;
        return details && typeof details === "object" && !Array.isArray(details)
          ? { ...remaining, ...details }
          : remaining;
      })()
    : null;
  const artifactDetails = sourceArtifact
    ? Object.fromEntries(
        Object.entries(sourceArtifact).filter(
          ([key]) =>
            !["name", "summary", "uri", "path", "ref", "id"].includes(key),
        ),
      )
    : null;
  const details = runEvidence
    ? Object.fromEntries(
        Object.entries(runEvidence).filter(
          ([key]) => !["ref", "kind", "summary"].includes(key),
        ),
      )
    : payloadDetails ?? artifactDetails;

  return Object.freeze({
    ref: reference,
    kind:
      runEvidence?.kind ??
      sourcePayload?.kind ??
      (sourceArtifact ? "artifact" : sourceEvent?.type ?? "evidence"),
    summary:
      runEvidence?.summary ??
      sourcePayload?.summary ??
      sourceArtifact?.summary ??
      sourceEvent?.reason ??
      "No Evidence summary recorded",
    sourceEventType: sourceEvent?.type ?? "UNKNOWN",
    sourceSequence: sourceEvent?.sequence ?? null,
    details: details && Object.keys(details).length > 0 ? details : null,
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
    decision: releaseDecision.decision ?? null,
    contextPackVersion: releaseDecision.contextPackVersion,
    evidence: Object.freeze([...releaseDecision.evidenceRefs]),
    evidenceDetails: Object.freeze(
      releaseDecision.evidenceRefs.map((reference) =>
        evidenceDetailsForReference(mission, reference),
      ),
    ),
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

function deriveExecutionModel(mission) {
  if (!mission.execution) {
    return null;
  }
  const execution = mission.execution;
  const roomsById = new Map(
    execution.decisionRooms.map((room) => [room.id, room]),
  );
  const nodes = execution.nodes.map((node) =>
    Object.freeze({
      id: node.assignment.id,
      goal: node.assignment.goal,
      dependsOn: Object.freeze([...node.dependsOn]),
      requiresDecision: node.requiresDecision,
      status: node.status,
      attempt: node.attempt ?? 0,
      currentWaveId: node.currentWaveId ?? null,
      roleId: node.agent?.roleId ?? null,
      roleName: node.agent?.roleName ?? null,
      effectivePermission: node.agent?.effectivePermission ?? null,
      runStatus: node.run?.status ?? null,
      artifactCount: node.artifacts.length,
      evidenceRefs: Object.freeze([...node.evidenceRefs]),
      latestEvidence: node.evidenceRefs.at(-1) ?? null,
    }),
  );
  const activity = [...mission.events]
    .filter(
      (event) =>
        event.type.startsWith("EXECUTION_") ||
        event.type.startsWith("DECISION_ROOM_") ||
        (event.type === "REVIEW_REJECTED" && mission.execution),
    )
    .sort((left, right) => right.sequence - left.sequence)
    .map((event) => {
      const roomId =
        event.data?.decisionRoom?.id ?? event.data?.decision?.roomId ?? null;
      const assignmentId =
        event.data?.assignmentId ??
        event.data?.decisionRoom?.assignmentId ??
        roomsById.get(roomId)?.assignmentId ??
        null;
      return Object.freeze({
        sequence: event.sequence,
        type: event.type,
        actor: event.actor,
        occurredAt: event.occurredAt,
        reason: event.reason,
        assignmentId,
        waveId: event.data?.waveId ?? event.data?.wave?.id ?? null,
        attempt: event.data?.attempt ?? null,
        evidenceRefs: Object.freeze([...event.evidenceRefs]),
      });
    });

  return Object.freeze({
    summary: Object.freeze({
      capacity: execution.capacity,
      reservedSlots: execution.reservedSlots,
      workerCapacity: execution.workerCapacity,
      availableWorkerSlots: execution.availableWorkerSlots,
      completedAssignments: execution.nodes.filter(
        (node) => node.status === "COMPLETED",
      ).length,
      totalAssignments: execution.nodes.length,
    }),
    frontier: Object.freeze([...execution.frontier]),
    activeAssignmentIds: Object.freeze([...execution.activeAssignmentIds]),
    decisionRequiredAssignmentIds: Object.freeze([
      ...execution.decisionRequiredAssignmentIds,
    ]),
    nodes: Object.freeze(nodes),
    waves: Object.freeze(
      structuredClone(execution.waves).map((wave) => Object.freeze(wave)),
    ),
    decisionRooms: Object.freeze(
      structuredClone(execution.decisionRooms).map((room) =>
        Object.freeze(room),
      ),
    ),
    activity: Object.freeze(activity),
    observed: nodes.some((node) => node.roleId !== null),
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
  const configuredTeam = deriveConfiguredTeamModel();
  const agentCards = deriveAgentCards([mission]);

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
    configuredTeam,
    agentCards,
    team: deriveTeamModel(configuredTeam, agentCards),
    execution: deriveExecutionModel(mission),
  });
}
