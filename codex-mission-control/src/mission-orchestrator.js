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

  function getMission(missionId) {
    const events = eventStore.load(missionId);
    if (events.length === 0) {
      throw new Error(`Mission not found: ${missionId}.`);
    }
    return projectMission(events, missionId);
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
