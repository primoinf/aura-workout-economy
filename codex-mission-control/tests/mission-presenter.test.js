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
