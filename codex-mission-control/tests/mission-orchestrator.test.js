import assert from "node:assert/strict";
import test from "node:test";

import {
  createLocalStorageEventStore,
  createMemoryEventStore,
  createBrowserWriteCoordinator,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";

const validBrief = {
  goal: "Ship a persistent no-release Mission tracer bullet",
  scope: "Mission lifecycle, local replay, Overview, and Mission Detail",
  acceptanceCriteria: [
    "Mission completes without release",
    "Reload reconstructs the same state",
  ],
  constraints: ["Do not deploy", "Do not mutate unrelated applications"],
  risk: "medium",
  mutationAuthority: "workspace-write:codex-mission-control",
  releaseRequired: false,
  releaseAuthority: "mission-owner",
};

function createHarness(eventStore = createMemoryEventStore()) {
  let eventNumber = 0;

  return createMissionOrchestrator({
    eventStore,
    clock: () => "2026-07-28T08:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-001" : `event-${++eventNumber}`,
  });
}

test("mission owner can create a Mission from a valid Brief", () => {
  const orchestrator = createHarness();

  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Start the approved tracer bullet",
  });

  assert.deepEqual(mission, {
    id: "mission-001",
    status: "BRIEF_ACCEPTED",
    contextPackVersion: 1,
    brief: validBrief,
    context: null,
    plan: null,
    run: null,
    artifact: null,
    review: null,
    validation: null,
    learning: null,
    completion: null,
    events: [
      {
        id: "event-1",
        missionId: "mission-001",
        sequence: 1,
        type: "MISSION_CREATED",
        actor: "mission-owner",
        occurredAt: "2026-07-28T08:00:00.000Z",
        reason: "Start the approved tracer bullet",
        contextPackVersion: 1,
        evidenceRefs: [],
        data: { brief: validBrief },
      },
    ],
    allowedActions: ["capture_context"],
  });
});

test("incomplete Brief is rejected without creating a Mission", () => {
  const orchestrator = createHarness();

  assert.throws(
    () =>
      orchestrator.createMission({
        brief: { ...validBrief, mutationAuthority: "" },
        actor: "mission-owner",
        reason: "This Brief is not ready",
      }),
    /Brief is missing: mutationAuthority/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);
});

test("release-required Brief is rejected until a release flow exists", () => {
  const orchestrator = createHarness();

  assert.throws(
    () =>
      orchestrator.createMission({
        brief: { ...validBrief, releaseRequired: true },
        actor: "mission-owner",
        reason: "Attempt a release flow before Ticket 03",
      }),
    /Release-required Missions are not available in Ticket 01/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);
});

test("Brief requires an explicit boolean release requirement", () => {
  const orchestrator = createHarness();

  assert.throws(
    () =>
      orchestrator.createMission({
        brief: { ...validBrief, releaseRequired: "false" },
        actor: "mission-owner",
        reason: "Attempt an ambiguous release requirement",
      }),
    /Brief releaseRequired must be a boolean/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);
});

test("no-release Mission completes through every observable lifecycle state", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Start the approved tracer bullet",
  });
  const commands = [
    {
      type: "CAPTURE_CONTEXT",
      payload: {
        context: {
          summary: "Approved PRD and hybrid UI decision",
          sourceRefs: ["docs://prd", "docs://ui-decision"],
        },
      },
      reason: "Attach the bounded Context Pack",
    },
    {
      type: "ACCEPT_PLAN",
      payload: { plan: { steps: ["build", "review", "validate"] } },
      reason: "Accept the no-release execution plan",
    },
    {
      type: "START_RUN",
      payload: { run: { agentRole: "mock-runner", mode: "local" } },
      reason: "Start the mocked local run",
    },
    {
      type: "SUBMIT_ARTIFACT",
      payload: {
        artifact: {
          name: "mission-control-tracer",
          uri: "artifact://mission-control-tracer",
        },
      },
      reason: "Submit the built artifact for review",
      evidenceRefs: ["evidence://artifact-1"],
    },
    {
      type: "PASS_REVIEW",
      payload: { review: { summary: "No material findings" } },
      reason: "Independent review passed",
      evidenceRefs: ["evidence://review-1"],
    },
    {
      type: "PASS_VALIDATION",
      payload: { validation: { summary: "Acceptance suite passed" } },
      reason: "Validation gate passed",
      evidenceRefs: ["evidence://validation-1"],
    },
    {
      type: "CAPTURE_LEARNING",
      payload: { learning: { summary: "Retain the orchestrator seam" } },
      reason: "Record bounded learning",
      evidenceRefs: ["evidence://learning-1"],
    },
    {
      type: "COMPLETE_NO_RELEASE",
      payload: {
        completion: { summary: "Accepted locally without release" },
      },
      reason: "Mission owner accepted the no-release outcome",
      evidenceRefs: ["evidence://completion-1"],
    },
  ];

  const statuses = [created.status];
  for (const command of commands) {
    statuses.push(
      orchestrator.execute(created.id, {
        ...command,
        actor: "mission-owner",
      }).status,
    );
  }
  const completed = orchestrator.getMission(created.id);

  assert.deepEqual(
    {
      statuses,
      finalStatus: completed.status,
      allowedActions: completed.allowedActions,
      eventTypes: completed.events.map((event) => event.type),
      eventSequences: completed.events.map((event) => event.sequence),
      evidenceRefs: completed.events.map((event) => event.evidenceRefs),
    },
    {
      statuses: [
        "BRIEF_ACCEPTED",
        "CONTEXT_READY",
        "PLANNED",
        "RUNNING",
        "IN_REVIEW",
        "VALIDATING",
        "LEARNING",
        "READY_TO_COMPLETE",
        "COMPLETED",
      ],
      finalStatus: "COMPLETED",
      allowedActions: [],
      eventTypes: [
        "MISSION_CREATED",
        "CONTEXT_CAPTURED",
        "PLAN_ACCEPTED",
        "RUN_STARTED",
        "ARTIFACT_SUBMITTED",
        "REVIEW_PASSED",
        "VALIDATION_PASSED",
        "LEARNING_CAPTURED",
        "MISSION_COMPLETED",
      ],
      eventSequences: [1, 2, 3, 4, 5, 6, 7, 8, 9],
      evidenceRefs: [
        [],
        [],
        [],
        [],
        ["evidence://artifact-1"],
        ["evidence://review-1"],
        ["evidence://validation-1"],
        ["evidence://learning-1"],
        ["evidence://completion-1"],
      ],
    },
  );
});

test("Mission event history is immutable at the public seam", () => {
  const orchestrator = createHarness();

  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create an auditable Mission",
  });

  assert.deepEqual(
    {
      events: Object.isFrozen(mission.events),
      event: Object.isFrozen(mission.events[0]),
      eventData: Object.isFrozen(mission.events[0].data),
      brief: Object.isFrozen(mission.events[0].data.brief),
    },
    {
      events: true,
      event: true,
      eventData: true,
      brief: true,
    },
  );
});

test("illegal lifecycle transition fails closed without appending an event", () => {
  const orchestrator = createHarness();
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a guarded Mission",
  });

  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "PASS_REVIEW",
        payload: { review: { summary: "Cannot happen before a run" } },
        actor: "mission-owner",
        reason: "Attempt to bypass Context, plan, and run",
        evidenceRefs: ["evidence://invalid-review"],
      }),
    /PASS_REVIEW is not allowed while Mission is BRIEF_ACCEPTED/,
  );
  assert.deepEqual(
    {
      status: orchestrator.getMission(mission.id).status,
      eventTypes: orchestrator
        .getMission(mission.id)
        .events.map((event) => event.type),
    },
    {
      status: "BRIEF_ACCEPTED",
      eventTypes: ["MISSION_CREATED"],
    },
  );
});

test("completed Mission reloads from local event history into the same state", () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
  let eventNumber = 0;
  const createPersistedOrchestrator = () =>
    createMissionOrchestrator({
      eventStore: createLocalStorageEventStore({
        storage,
        key: "mission-control-test",
      }),
      clock: () => "2026-07-28T09:00:00.000Z",
      createId: (kind) =>
        kind === "mission" ? "mission-persisted" : `persisted-${++eventNumber}`,
    });
  const firstSession = createPersistedOrchestrator();
  const mission = firstSession.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission that survives reload",
  });
  const commands = [
    ["CAPTURE_CONTEXT", "context", { summary: "Versioned Context Pack" }],
    ["ACCEPT_PLAN", "plan", { steps: ["run locally"] }],
    ["START_RUN", "run", { agentRole: "mock-runner" }],
    ["SUBMIT_ARTIFACT", "artifact", { uri: "artifact://persisted" }],
    ["PASS_REVIEW", "review", { summary: "Review passed" }],
    ["PASS_VALIDATION", "validation", { summary: "Validation passed" }],
    ["CAPTURE_LEARNING", "learning", { summary: "Learning recorded" }],
    [
      "COMPLETE_NO_RELEASE",
      "completion",
      { summary: "Completed without release" },
    ],
  ];
  let completed;
  for (const [type, field, value] of commands) {
    completed = firstSession.execute(mission.id, {
      type,
      payload: { [field]: value },
      actor: "mission-owner",
      reason: `Advance with ${type}`,
      evidenceRefs: [
        "SUBMIT_ARTIFACT",
        "PASS_REVIEW",
        "PASS_VALIDATION",
        "CAPTURE_LEARNING",
        "COMPLETE_NO_RELEASE",
      ].includes(type)
        ? [`evidence://${field}`]
        : [],
    });
  }

  const reloadedSession = createPersistedOrchestrator();
  const reloaded = reloadedSession.getMission(mission.id);

  assert.deepEqual(
    {
      sameProjection: reloaded,
      listedIds: reloadedSession.listMissions().map((item) => item.id),
    },
    {
      sameProjection: completed,
      listedIds: ["mission-persisted"],
    },
  );
});

test("replay rejects an out-of-order event that bypasses lifecycle gates", () => {
  const source = createHarness();
  const mission = source.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission before corrupting its stored history",
  });
  const corruptedStore = createMemoryEventStore({
    [mission.id]: [
      mission.events[0],
      {
        id: "event-forged",
        missionId: mission.id,
        sequence: 99,
        type: "MISSION_COMPLETED",
        actor: "forged-writer",
        occurredAt: "2026-07-28T10:00:00.000Z",
        reason: "Attempt to bypass every lifecycle gate",
        contextPackVersion: 1,
        evidenceRefs: ["evidence://forged"],
        data: { completion: { summary: "This must not replay" } },
      },
    ],
  });
  const reloaded = createMissionOrchestrator({
    eventStore: corruptedStore,
    clock: () => "2026-07-28T10:00:00.000Z",
    createId: () => "unused",
  });

  assert.throws(
    () => reloaded.getMission(mission.id),
    /Cannot replay event 99: expected sequence 2/,
  );
});

test("replay rejects a sequential event that skips required lifecycle gates", () => {
  const source = createHarness();
  const mission = source.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission before forging a gate bypass",
  });
  const bypassStore = createMemoryEventStore({
    [mission.id]: [
      mission.events[0],
      {
        id: "event-sequential-bypass",
        missionId: mission.id,
        sequence: 2,
        type: "MISSION_COMPLETED",
        actor: "forged-writer",
        occurredAt: "2026-07-28T10:00:00.000Z",
        reason: "Attempt a sequential gate bypass",
        contextPackVersion: 1,
        evidenceRefs: ["evidence://forged"],
        data: { completion: { summary: "This must not replay" } },
      },
    ],
  });
  const reloaded = createMissionOrchestrator({
    eventStore: bypassStore,
    clock: () => "2026-07-28T10:00:00.000Z",
    createId: () => "unused",
  });

  assert.throws(
    () => reloaded.getMission(mission.id),
    /MISSION_COMPLETED is not allowed while Mission is BRIEF_ACCEPTED/,
  );
});

test("replay rejects an event stored under a different Mission identity", () => {
  const source = createHarness();
  const mission = source.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission before corrupting its identity",
  });
  const mismatchedStore = createMemoryEventStore({
    [mission.id]: [{ ...mission.events[0], missionId: "mission-other" }],
  });
  const reloaded = createMissionOrchestrator({
    eventStore: mismatchedStore,
    clock: () => "2026-07-28T10:00:00.000Z",
    createId: () => "unused",
  });

  assert.throws(
    () => reloaded.getMission(mission.id),
    /Mission ID does not match/,
  );
});

test("accepted commands require an actor and reason before appending events", () => {
  const orchestrator = createHarness();

  assert.throws(
    () =>
      orchestrator.createMission({
        brief: validBrief,
        actor: "",
        reason: "Attempt without an accountable actor",
      }),
    /Command actor is required/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);

  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create an accountable Mission",
  });
  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "CAPTURE_CONTEXT",
        payload: { context: { summary: "Context without a reason" } },
        actor: "mission-owner",
        reason: " ",
      }),
    /Command reason is required/,
  );
  assert.deepEqual(
    orchestrator.getMission(mission.id).events.map((event) => event.type),
    ["MISSION_CREATED"],
  );
});

test("lifecycle command requires its observable payload before appending an event", () => {
  const orchestrator = createHarness();
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with guarded payloads",
  });

  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "CAPTURE_CONTEXT",
        payload: { context: null },
        actor: "mission-owner",
        reason: "Attempt to advance with null Context",
      }),
    /CAPTURE_CONTEXT requires context/,
  );
  assert.deepEqual(
    {
      status: orchestrator.getMission(mission.id).status,
      eventCount: orchestrator.getMission(mission.id).events.length,
    },
    { status: "BRIEF_ACCEPTED", eventCount: 1 },
  );
});

test("evidence-bearing transition fails closed when Evidence is missing", () => {
  const orchestrator = createHarness();
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with guarded Evidence",
  });
  const setupCommands = [
    ["CAPTURE_CONTEXT", "context", { summary: "Bounded Context" }],
    ["ACCEPT_PLAN", "plan", { steps: ["run"] }],
    ["START_RUN", "run", { agentRole: "mock-runner" }],
  ];
  for (const [type, field, value] of setupCommands) {
    orchestrator.execute(mission.id, {
      type,
      payload: { [field]: value },
      actor: "mission-owner",
      reason: `Advance with ${type}`,
    });
  }

  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "SUBMIT_ARTIFACT",
        payload: { artifact: { uri: "artifact://missing-evidence" } },
        actor: "mission-owner",
        reason: "Attempt submission without Evidence",
      }),
    /SUBMIT_ARTIFACT requires at least one Evidence reference/,
  );
  assert.deepEqual(
    {
      status: orchestrator.getMission(mission.id).status,
      eventCount: orchestrator.getMission(mission.id).events.length,
    },
    { status: "RUNNING", eventCount: 4 },
  );
});

test("competing writer cannot overwrite or duplicate the next event sequence", () => {
  const baseStore = createMemoryEventStore();
  let injectCompetingEvent = false;
  const competingStore = {
    append(missionId, events, options) {
      if (injectCompetingEvent) {
        injectCompetingEvent = false;
        baseStore.append(
          missionId,
          [
            {
              ...events[0],
              id: "event-competing-writer",
              actor: "other-tab",
              reason: "A competing writer won this event sequence",
            },
          ],
          options,
        );
      }
      baseStore.append(missionId, events, options);
    },
    load: baseStore.load,
    listMissionIds: baseStore.listMissionIds,
    triggerConflict() {
      injectCompetingEvent = true;
    },
  };
  const orchestrator = createHarness(competingStore);
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission before a competing write",
  });
  competingStore.triggerConflict();

  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "CAPTURE_CONTEXT",
        payload: { context: { summary: "Original writer Context" } },
        actor: "mission-owner",
        reason: "Original writer attempts the next event",
      }),
    /Event history changed: expected 1 events but found 2/,
  );
  assert.deepEqual(
    {
      status: orchestrator.getMission(mission.id).status,
      eventActors: orchestrator
        .getMission(mission.id)
        .events.map((event) => event.actor),
    },
    {
      status: "CONTEXT_READY",
      eventActors: ["mission-owner", "other-tab"],
    },
  );
});

test("browser write coordinator serializes two Orchestrators racing for one sequence", async () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
  let lockTail = Promise.resolve();
  const locks = {
    request(_name, _options, task) {
      const result = lockTail.then(task);
      lockTail = result.catch(() => undefined);
      return result;
    },
  };
  const writeCoordinator = createBrowserWriteCoordinator({
    locks,
    lockName: "mission-control-test-lock",
  });
  const eventStore = createLocalStorageEventStore({
    storage,
    key: "mission-control-race-test",
  });
  let firstEvent = 0;
  let secondEvent = 0;
  const first = createMissionOrchestrator({
    eventStore,
    writeCoordinator,
    clock: () => "2026-07-28T11:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-race" : `first-${++firstEvent}`,
  });
  const second = createMissionOrchestrator({
    eventStore,
    writeCoordinator,
    clock: () => "2026-07-28T11:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-unused" : `second-${++secondEvent}`,
  });
  const mission = await first.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission before two tabs race",
  });
  const command = (summary) => ({
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary } },
    actor: "mission-owner",
    reason: `Capture ${summary}`,
  });

  const results = await Promise.allSettled([
    first.execute(mission.id, command("Context from first tab")),
    second.execute(mission.id, command("Context from second tab")),
  ]);

  assert.deepEqual(
    {
      resultStates: results.map((result) => result.status),
      rejectedReason:
        results[1].status === "rejected" ? results[1].reason.message : null,
      missionStatus: first.getMission(mission.id).status,
      eventCount: first.getMission(mission.id).events.length,
    },
    {
      resultStates: ["fulfilled", "rejected"],
      rejectedReason:
        "CAPTURE_CONTEXT is not allowed while Mission is CONTEXT_READY.",
      missionStatus: "CONTEXT_READY",
      eventCount: 2,
    },
  );
});
