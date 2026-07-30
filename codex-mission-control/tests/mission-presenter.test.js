import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCommandDeckModel,
  deriveMissionFlowModel,
} from "../src/mission-presenter.js";
import {
  createMemoryEventStore,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";

const brief = {
  goal: "Ship an auditable Mission flow",
  scope: "Local production UI only",
  acceptanceCriteria: ["Every visible status comes from Mission history"],
  constraints: ["No external mutation"],
  risk: "medium",
  releaseRequired: false,
  mutationAuthority: "Local storage only",
  releaseAuthority: "Mission owner",
};

function event(sequence, type, occurredAt, evidenceRefs = []) {
  return {
    id: `event-${sequence}`,
    missionId: "mission-active",
    sequence,
    type,
    actor: "mission-owner",
    occurredAt,
    reason: `Record ${type}`,
    contextPackVersion: 1,
    evidenceRefs,
    data: {},
  };
}

test("Command Deck derives honest metrics and configured team state from Mission projections", () => {
  const activeMission = {
    id: "mission-active",
    brief,
    status: "RUNNING",
    contextPackVersion: 1,
    allowedActions: ["submit_artifact"],
    events: [
      event(1, "MISSION_CREATED", "2026-07-28T10:00:00.000Z"),
      event(2, "RUN_STARTED", "2026-07-28T10:05:00.000Z"),
    ],
  };
  const completedMission = {
    ...activeMission,
    id: "mission-complete",
    status: "COMPLETED",
    allowedActions: [],
    events: [
      {
        ...event(1, "MISSION_COMPLETED", "2026-07-28T11:00:00.000Z", [
          "evidence://completion",
        ]),
        missionId: "mission-complete",
      },
    ],
  };

  const model = deriveCommandDeckModel([activeMission, completedMission]);

  assert.deepEqual(
    {
      metrics: model.metrics,
      configuredRoleCount: model.team.length,
      teamRuntime: model.team.map((role) => ({
        name: role.name,
        connection: role.connection,
        assignment: role.assignment,
      })),
      activeNextAction: model.missions.find(
        (mission) => mission.id === "mission-active",
      ).nextAction,
      latestSignal: model.latestSignals[0],
    },
    {
      metrics: {
        activeMissions: 1,
        completedMissions: 1,
        auditEvents: 3,
        configuredAgents: 6,
        agentTelemetry: "Unavailable",
      },
      configuredRoleCount: 6,
      teamRuntime: [
        {
          name: "Orchestrator",
          connection: "Not connected",
          assignment: "No assignment",
        },
        {
          name: "Luna Worker",
          connection: "Not connected",
          assignment: "No assignment",
        },
        {
          name: "Terra Builder",
          connection: "Not connected",
          assignment: "No assignment",
        },
        {
          name: "Terra Debugger",
          connection: "Not connected",
          assignment: "No assignment",
        },
        {
          name: "Sol Architect",
          connection: "Not connected",
          assignment: "No assignment",
        },
        {
          name: "Sol Reviewer",
          connection: "Not connected",
          assignment: "No assignment",
        },
      ],
      activeNextAction: "submit_artifact",
      latestSignal: {
        missionId: "mission-complete",
        missionGoal: "Ship an auditable Mission flow",
        sequence: 1,
        type: "MISSION_COMPLETED",
        actor: "mission-owner",
        occurredAt: "2026-07-28T11:00:00.000Z",
        reason: "Record MISSION_COMPLETED",
        evidenceCount: 1,
      },
    },
  );
});

test("Mission Flow derives lifecycle completion and evidence counts without inventing confidence", () => {
  let generatedId = 0;
  const orchestrator = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    clock: () => "2026-07-28T10:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-active" : `event-${++generatedId}`,
  });
  const created = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a real Mission projection for the presenter",
  });
  const commands = [
    {
      type: "CAPTURE_CONTEXT",
      payload: { context: { summary: "Versioned local Context" } },
      reason: "Capture Context",
    },
    {
      type: "ACCEPT_PLAN",
      payload: { plan: { steps: ["run", "review", "validate"] } },
      reason: "Accept plan",
    },
    {
      type: "START_RUN",
      payload: { run: { agentRole: "mock-runner" } },
      reason: "Start run",
    },
    {
      type: "SUBMIT_ARTIFACT",
      payload: { artifact: { uri: "artifact://ui-01" } },
      reason: "Submit artifact",
      evidenceRefs: ["evidence://artifact"],
    },
    {
      type: "PASS_REVIEW",
      payload: { review: { summary: "No material finding" } },
      reason: "Pass independent review",
      evidenceRefs: ["evidence://review"],
    },
  ];
  let mission = created;
  for (const command of commands) {
    mission = orchestrator.execute(created.id, {
      ...command,
      actor: "mission-owner",
    });
  }

  const model = deriveMissionFlowModel(mission);

  assert.deepEqual(
    {
      lifecycleCompletion: model.lifecycleCompletion,
      currentStage: model.currentStage,
      nextAction: model.nextAction,
      evidenceCount: model.evidenceCount,
      completedStages: model.stages
        .filter((stage) => stage.state === "done")
        .map((stage) => stage.status),
      activeStage: model.stages.find((stage) => stage.state === "current"),
    },
    {
      lifecycleCompletion: 67,
      currentStage: {
        status: "VALIDATING",
        label: "Validation",
        position: 6,
        total: 9,
      },
      nextAction: "pass_validation",
      evidenceCount: 2,
      completedStages: [
        "BRIEF_ACCEPTED",
        "CONTEXT_READY",
        "PLANNED",
        "RUNNING",
        "IN_REVIEW",
      ],
      activeStage: {
        status: "VALIDATING",
        label: "Validation",
        index: 5,
        number: 6,
        state: "current",
      },
    },
  );
});

test("team telemetry is derived only from observable Assignment and Run state", () => {
  const observedMission = {
    id: "mission-observed",
    brief,
    status: "IN_REVIEW",
    contextPackVersion: 1,
    allowedActions: ["pass_review"],
    assignment: {
      id: "assignment-001",
      goal: "Inventory Mission event types",
    },
    agent: {
      roleId: "luna_worker",
      roleName: "Luna Worker",
      capability: "deterministic",
      effectivePermission: "read-only",
    },
    run: {
      id: "run-001",
      status: "COMPLETED",
      startedAt: "2026-07-30T08:00:00.000Z",
      updatedAt: "2026-07-30T08:02:00.000Z",
      modelMetadata: {
        name: "observable-model",
        reasoningEffort: "medium",
      },
      evidence: [
        {
          ref: "evidence://event-inventory",
          kind: "inspection",
          summary: "Sorted event names from the bounded source",
        },
      ],
    },
    events: [
      {
        ...event(1, "MISSION_CREATED", "2026-07-30T07:58:00.000Z"),
        missionId: "mission-observed",
      },
      {
        ...event(2, "ASSIGNMENT_ROUTED", "2026-07-30T07:59:00.000Z"),
        missionId: "mission-observed",
      },
      {
        ...event(
          3,
          "AGENT_RUN_COMPLETED",
          "2026-07-30T08:02:00.000Z",
          ["evidence://event-inventory"],
        ),
        missionId: "mission-observed",
      },
    ],
  };

  const overview = deriveCommandDeckModel([observedMission]);
  const flow = deriveMissionFlowModel(observedMission);
  const overviewLuna = overview.team.find(
    (role) => role.id === "luna_worker",
  );
  const flowLuna = flow.team.find((role) => role.id === "luna_worker");
  const terra = overview.team.find((role) => role.id === "terra_builder");
  const expectedLuna = {
    id: "luna_worker",
    initials: "LU",
    name: "Luna Worker",
    role: "Operations",
    capability: "Deterministic search, extraction, and checks",
    permission: "Bounded worker",
    tone: "violet",
    connection: "Observed",
    assignment: "Inventory Mission event types",
    telemetry: "Completed · 2m",
    runtimeStatus: "COMPLETED",
    effectivePermission: "read-only",
    modelMetadata: {
      name: "observable-model",
      reasoningEffort: "medium",
    },
    elapsedTime: "2m",
    latestEvidence: "evidence://event-inventory",
    missionId: "mission-observed",
  };

  assert.deepEqual(
    {
      agentTelemetry: overview.metrics.agentTelemetry,
      overviewLuna,
      flowLuna,
      disconnectedTerra: {
        connection: terra.connection,
        runtimeStatus: terra.runtimeStatus,
        assignment: terra.assignment,
        modelMetadata: terra.modelMetadata,
      },
    },
    {
      agentTelemetry: "Observed",
      overviewLuna: expectedLuna,
      flowLuna: expectedLuna,
      disconnectedTerra: {
        connection: "Not connected",
        runtimeStatus: "DISCONNECTED",
        assignment: "No assignment",
        modelMetadata: null,
      },
    },
  );
});

test("team telemetry exposes an observed transport error as error, not working", () => {
  const failedMission = {
    id: "mission-error",
    brief,
    status: "PLANNED",
    contextPackVersion: 1,
    allowedActions: [],
    assignment: {
      id: "assignment-error",
      goal: "Run a bounded inspection",
    },
    agent: {
      roleId: "luna_worker",
      roleName: "Luna Worker",
      capability: "deterministic",
      effectivePermission: "read-only",
    },
    run: {
      id: "unavailable:assignment-error",
      status: "ERROR",
      updatedAt: "2026-07-30T08:00:00.000Z",
      error: "Codex agent transport is unavailable",
    },
    events: [
      {
        ...event(1, "MISSION_CREATED", "2026-07-30T07:58:00.000Z"),
        missionId: "mission-error",
      },
      {
        ...event(2, "AGENT_RUN_ERROR", "2026-07-30T08:00:00.000Z"),
        missionId: "mission-error",
      },
    ],
  };

  const luna = deriveCommandDeckModel([failedMission]).team.find(
    (role) => role.id === "luna_worker",
  );

  assert.deepEqual(
    {
      connection: luna.connection,
      runtimeStatus: luna.runtimeStatus,
      telemetry: luna.telemetry,
      assignment: luna.assignment,
      elapsedTime: luna.elapsedTime,
    },
    {
      connection: "Error",
      runtimeStatus: "ERROR",
      telemetry: "Error",
      assignment: "Run a bounded inspection",
      elapsedTime: null,
    },
  );
});
