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

export const MISSION_STATUS_ORDER = Object.freeze([
  "BRIEF_ACCEPTED",
  "CONTEXT_READY",
  "PLANNED",
  "RUNNING",
  "IN_REVIEW",
  "VALIDATING",
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

const COMMAND_BY_STATUS = Object.fromEntries(
  Object.values(COMMANDS).map((command) => [command.from, command]),
);

export const MISSION_COMMAND_BY_ACTION = Object.freeze(
  Object.fromEntries(
    Object.entries(COMMANDS).map(([commandType, command]) => [
      command.action,
      commandType,
    ]),
  ),
);

const EVENT_PROJECTIONS = Object.fromEntries(
  Object.values(COMMANDS).map((command) => [command.eventType, command]),
);

const AGENT_EVENT_TYPES = new Set([
  "ASSIGNMENT_ROUTED",
  "AGENT_RUN_STARTED",
  "AGENT_RUN_UPDATED",
  "AGENT_RUN_COMPLETED",
  "AGENT_RUN_BLOCKED",
  "AGENT_RUN_ERROR",
]);

function clone(value) {
  return structuredClone(value);
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
    throw new Error(
      "Release-required Missions are not available in Ticket 01.",
    );
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

function projectAgentEvent(mission, event) {
  if (event.type === "ASSIGNMENT_ROUTED") {
    if (mission.status !== "PLANNED" || mission.assignment) {
      throw new Error(
        `Cannot replay event ${event.sequence}: ASSIGNMENT_ROUTED is not allowed while Mission is ${mission.status}.`,
      );
    }
    assertReplayObject(event.data.assignment, event, "assignment");
    assertReplayObject(event.data.agent, event, "agent");
    assertReplayString(event.data.assignment.id, event, "Assignment ID");
    assertReplayString(event.data.assignment.goal, event, "Assignment goal");
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
    mission.assignment = clone(event.data.assignment);
    mission.agent = clone(event.data.agent);
    mission.allowedActions = [];
    return;
  }

  if (!mission.assignment || !mission.agent) {
    throw new Error(
      `Cannot replay event ${event.sequence}: ${event.type} requires a routed Assignment.`,
    );
  }
  assertReplayObject(event.data.run, event, "run");

  if (event.type === "AGENT_RUN_STARTED") {
    if (mission.status !== "PLANNED" || mission.run) {
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
    mission.run = clone(event.data.run);
    mission.allowedActions = [];
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
    mission.allowedActions = [];
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
    mission.allowedActions = [];
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
    mission.status = "IN_REVIEW";
    mission.run = clone(event.data.run);
    mission.artifacts = clone(event.data.artifacts);
    mission.artifact = clone(event.data.artifacts[0]);
    mission.allowedActions = [COMMAND_BY_STATUS.IN_REVIEW.action];
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
    mission.allowedActions = [];
    return;
  }

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
    run: null,
    artifact: null,
    review: null,
    validation: null,
    learning: null,
    completion: null,
    events: clone(events),
    allowedActions: [COMMAND_BY_STATUS.BRIEF_ACCEPTED.action],
  };

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

    mission.status = projection.to;
    mission[projection.field] = clone(event.data[projection.field]);
    mission.allowedActions = COMMAND_BY_STATUS[projection.to]
      ? [COMMAND_BY_STATUS[projection.to].action]
      : [];
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
    },
    load(missionId) {
      return clone(eventsByMission.get(missionId) ?? []);
    },
    listMissionIds() {
      return [...eventsByMission.keys()];
    },
  };
}

export function createLocalStorageEventStore({
  storage = globalThis.localStorage,
  key = "codex-mission-control-events-v1",
} = {}) {
  if (!storage) {
    throw new Error("A local storage implementation is required.");
  }

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
    },
    load(missionId) {
      return clone(readAll()[missionId] ?? []);
    },
    listMissionIds() {
      return Object.keys(readAll());
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

  function getMission(missionId) {
    const events = eventStore.load(missionId);
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
    const authorizedRoots = authority
      .slice(prefix.length)
      .split(",")
      .map((path) => path.trim().replaceAll("\\", "/").replace(/\/+$/, ""))
      .filter(Boolean);
    const writePaths = routing.assignment.ownershipBoundary.writePaths.map(
      (path) => path.replaceAll("\\", "/").replace(/\/+$/, ""),
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

  return {
    createMission(input) {
      return writeCoordinator.runExclusive(() => {
        const { brief, actor, reason } = input;
        assertValidBrief(brief);
        assertAuditMetadata({ actor, reason });

        const missionId = createId("mission");
        const event = {
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
        .map((missionId) =>
          projectMission(eventStore.load(missionId), missionId),
        );
    },
    getMission,
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
            if (mission.status !== "PLANNED") {
              throw new Error(
                `Assignment routing is not allowed while Mission is ${mission.status}.`,
              );
            }
            assertAssignmentWithinMissionAuthority(mission, routing);
          },
        }),
      );

      try {
        for await (const observation of agentRouter.run(routing)) {
          await writeCoordinator.runExclusive(() => {
            const mission = getMission(missionId);
            const run = runFromObservation(mission, observation);
            const eventType = `AGENT_${observation.type}`;
            const eventReason =
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
          });
        }
      } catch (error) {
        await writeCoordinator.runExclusive(() => {
          const mission = getMission(missionId);
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
        await writeCoordinator.runExclusive(() =>
          appendAgentEvent(missionId, {
            type: "AGENT_RUN_ERROR",
            actor: "agent-router",
            reason: error.message,
            data: {
              run: {
                ...(mission.run ? clone(mission.run) : {}),
                id: mission.run?.id ?? `unavailable:${routing.assignment.id}`,
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
        const command = COMMANDS[type];

        if (!command) {
          throw new Error(`Unknown command: ${type}.`);
        }
        assertAuditMetadata({ actor, reason });
        if (mission.status !== command.from) {
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

        const event = {
          id: createId("event"),
          missionId,
          sequence: mission.events.length + 1,
          type: command.eventType,
          actor,
          occurredAt: clock(),
          reason,
          contextPackVersion: mission.contextPackVersion,
          evidenceRefs: clone(evidenceRefs),
          data: clone(payload),
        };
        eventStore.append(missionId, [event], {
          expectedSequence: mission.events.length,
        });
        return getMission(missionId);
      });
    },
  };
}
