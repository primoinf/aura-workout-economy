import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveApprovalRoomModel,
  deriveCommandDeckModel,
  deriveMissionFlowModel,
} from "../src/mission-presenter.js";
import {
  createMemoryEventStore,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";
import { createAgentRoutingAdapter } from "../src/agent-routing-adapter.js";

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

function sourceBackedContext(summary) {
  return {
    summary,
    capturedAt: "2026-07-30T12:59:00.000Z",
    sources: [
      {
        kind: "workspace-rules",
        ref: "workspace://AGENTS.md",
        status: "available",
      },
      {
        kind: "repository-state",
        ref: "git://status@784ac616",
        status: "available",
      },
      {
        kind: "recent-context",
        ref: "workspace://hotcache.md",
        status: "available",
      },
      {
        kind: "task-status",
        ref: "workspace://task-board.md#TASK-050",
        status: "available",
      },
      {
        kind: "decisions",
        ref: "workspace://decisions/TASK-050",
        status: "available",
      },
    ],
    facts: [
      {
        statement: `${summary} is source-backed test Context.`,
        sourceRefs: ["workspace://task-board.md#TASK-050"],
      },
    ],
    assumptions: [],
  };
}

function releaseTaskGraph() {
  const contextSlice = {
    summary: "Bound to the release Context Pack",
    sourceRefs: ["workspace://task-board.md#TASK-050"],
  };
  const base = {
    acceptanceCriteria: ["Produce observable release Evidence"],
    contextSlice,
    ownershipBoundary: {
      readPaths: ["codex-mission-control/src"],
      writePaths: [],
    },
    effectivePermission: "read-only",
    budget: { maxTurns: 2, maxMinutes: 5 },
    expectedEvidence: ["Transport-observed release Evidence"],
    workKind: "deterministic",
    risk: "low",
  };
  return {
    capacity: 4,
    coordinationRequired: true,
    assignments: [
      {
        ...base,
        id: "build-release-candidate",
        goal: "Build the exact release candidate",
        dependsOn: [],
        workKind: "implementation",
        risk: "medium",
        effectivePermission: "workspace-write",
        ownershipBoundary: {
          readPaths: ["codex-mission-control/src"],
          writePaths: ["codex-mission-control/src"],
        },
        expectedEvidence: ["Inspectable release candidate Evidence"],
      },
      {
        ...base,
        id: "validate-release-unit",
        goal: "Run the declared unit-tests release gate",
        dependsOn: ["build-release-candidate"],
        validationGateType: "unit-tests",
      },
      {
        ...base,
        id: "validate-release-integration",
        goal: "Run the declared integration-tests release gate",
        dependsOn: ["build-release-candidate"],
        validationGateType: "integration-tests",
      },
      {
        ...base,
        id: "review-release-candidate",
        goal: "Independently review the exact release candidate",
        dependsOn: [
          "validate-release-unit",
          "validate-release-integration",
        ],
        workKind: "review",
        risk: "high",
        expectedEvidence: ["Structured independent review outcome"],
      },
    ],
  };
}

function createReleaseRouter() {
  return createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-07-30T13:01:00.000Z",
        };
        if (assignmentId === "build-release-candidate") {
          yield {
            kind: "completed",
            runId: `run:${assignmentId}`,
            occurredAt: "2026-07-30T13:02:00.000Z",
            summary: "Built the exact release candidate",
            artifacts: [
              {
                name: "release-42",
                uri: "artifact://release-42",
                diff: "@@ release-42 @@\n+candidate content",
              },
            ],
            evidence: [
              {
                ref: "evidence://artifact-42",
                kind: "test",
                summary: "Candidate build and tests completed",
              },
            ],
          };
          return;
        }
        if (request.assignment.validationGateType) {
          const gateType = request.assignment.validationGateType;
          const evidenceRef = `evidence://validation-${gateType}`;
          yield {
            kind: "completed",
            runId: `run:${assignmentId}`,
            occurredAt: "2026-07-30T13:03:00.000Z",
            summary: `${gateType} passed`,
            artifacts: [
              {
                name: `${gateType}-validation-outcome`,
                uri: `artifact://validation/${gateType}`,
                validationOutcome: {
                  type: gateType,
                  status: "PASSED",
                  outcome: "PASSED",
                  evidenceRef,
                },
              },
            ],
            evidence: [
              {
                ref: evidenceRef,
                kind: "test",
                summary: `${gateType} passed through transport`,
              },
            ],
          };
          return;
        }
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-07-30T13:04:00.000Z",
          summary: "Independent reviewer completed the release review",
          artifacts: [
            {
              name: "release-review-outcome",
              uri: "artifact://release-review-outcome",
              reviewOutcome: {
                outcome: "PASSED",
                candidateArtifactRefs:
                  request.reviewContext?.candidateArtifactRefs ?? [],
                findings: [],
              },
            },
          ],
          evidence: [
            {
              ref: "evidence://review-42",
              kind: "review",
              summary: "Independent Sol Reviewer passed the candidate",
            },
          ],
        };
      },
    },
  });
}

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
        cancelledMissions: 0,
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

test("same-role Runs stay distinct and only routed waiting work receives a queue position", () => {
  const node = (id, sequence, status = "WORKING") => ({
    assignment: {
      id,
      goal: `Build ${id}`,
      effectivePermission: "workspace-write",
    },
    dependsOn: [],
    requiresDecision: false,
    status,
    attempt: 1,
    currentWaveId: "wave-concurrent",
    agent: {
      roleId: "terra_builder",
      roleName: "Terra Builder",
      capability: "implementation",
      effectivePermission: "workspace-write",
    },
    run:
      status === "ASSIGNED"
        ? null
        : {
            id: `run:${id}`,
            status: "WORKING",
            startedAt: `2026-08-08T09:0${sequence}:00.000Z`,
            updatedAt: `2026-08-08T09:0${sequence}:00.000Z`,
            evidence: [],
          },
    artifacts: [],
    evidenceRefs: [],
  });
  const mission = {
    id: "mission-concurrent-builders",
    brief,
    status: "RUNNING",
    contextPackVersion: 1,
    allowedActions: ["block_mission", "cancel_mission"],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      workerCapacity: 3,
      availableWorkerSlots: 0,
      frontier: [],
      activeAssignmentIds: ["build-a", "build-b", "build-c"],
      decisionRequiredAssignmentIds: [],
      nodes: [
        node("build-a", 1),
        node("build-b", 2),
        node("build-c", 3, "ASSIGNED"),
      ],
      waves: [
        {
          id: "wave-concurrent",
          assignmentIds: ["build-a", "build-b", "build-c"],
          serializedAssignmentIds: [],
          deferredAssignmentIds: [],
          status: "WORKING",
        },
      ],
      decisionRooms: [],
    },
    events: [
      {
        ...event(1, "MISSION_CREATED", "2026-08-08T09:00:00.000Z"),
        missionId: "mission-concurrent-builders",
      },
      {
        ...event(
          2,
          "EXECUTION_WAVE_DISPATCHED",
          "2026-08-08T09:01:00.000Z",
        ),
        missionId: "mission-concurrent-builders",
        data: {
          wave: {
            id: "wave-concurrent",
            assignmentIds: ["build-a", "build-b"],
          },
        },
      },
      {
        ...event(3, "EXECUTION_RUN_STARTED", "2026-08-08T09:01:00.000Z"),
        missionId: "mission-concurrent-builders",
        data: { assignmentId: "build-a", waveId: "wave-concurrent" },
      },
      {
        ...event(4, "EXECUTION_RUN_STARTED", "2026-08-08T09:02:00.000Z"),
        missionId: "mission-concurrent-builders",
        data: { assignmentId: "build-b", waveId: "wave-concurrent" },
      },
    ],
  };

  const model = deriveMissionFlowModel(mission);
  assert.deepEqual(
    Object.fromEntries(
      model.agentCards.map((card) => [
        card.assignmentId,
        {
          roleId: card.id,
          runtimeStatus: card.runtimeStatus,
          queuePosition: card.queuePosition,
        },
      ]),
    ),
    {
      "build-a": {
        roleId: "terra_builder",
        runtimeStatus: "WORKING",
        queuePosition: null,
      },
      "build-b": {
        roleId: "terra_builder",
        runtimeStatus: "WORKING",
        queuePosition: null,
      },
      "build-c": {
        roleId: "terra_builder",
        runtimeStatus: "ASSIGNED",
        queuePosition: 1,
      },
    },
  );
  assert.equal(
    model.team.filter((card) => card.id === "terra_builder").length,
    3,
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
      payload: { context: sourceBackedContext("Versioned local Context") },
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
    assignmentId: "assignment-001",
    runId: "run-001",
    queuePosition: null,
    cardId: "mission-observed:assignment-001:run-001",
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

test("Mission Flow distinguishes changes-requested, blocked, resumed, and cancelled control states", () => {
  let generatedId = 0;
  const orchestrator = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    clock: () => "2026-07-30T10:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-control-loop" : `event-${++generatedId}`,
  });
  const created = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a Mission with observable control states",
  });
  const execute = (type, payload, reason, evidenceRefs = []) =>
    orchestrator.execute(created.id, {
      type,
      payload,
      actor: "mission-owner",
      reason,
      evidenceRefs,
    });
  execute(
    "CAPTURE_CONTEXT",
    { context: sourceBackedContext("Control-state presentation Context") },
    "Capture Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "correct"] } },
    "Accept plan",
  );
  execute(
    "START_RUN",
    { run: { id: "run-001", agentRole: "terra_builder" } },
    "Start implementation",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate", uri: "artifact://candidate" } },
    "Submit candidate",
    ["evidence://artifact"],
  );
  const changesRequested = execute(
    "REJECT_REVIEW",
    { review: { summary: "Retry guard is incomplete" } },
    "Review requested an idempotency correction",
    ["evidence://review-failure"],
  );
  const changesModel = deriveMissionFlowModel(changesRequested);

  const blocked = execute(
    "BLOCK_MISSION",
    {
      block: {
        blocker: "Required replay fixture is unavailable",
        attemptedAlternatives: ["Inspected existing fixtures"],
        requiredAuthorityOrInput: "Provide the missing fixture",
      },
    },
    "Pause the requested correction",
  );
  const blockedModel = deriveMissionFlowModel(blocked);

  const resumed = execute(
    "RESUME_MISSION",
    { resumption: { summary: "Replay fixture supplied" } },
    "Resume the requested correction",
  );
  const resumedModel = deriveMissionFlowModel(resumed);

  const cancelled = execute(
    "CANCEL_MISSION",
    { cancellation: { summary: "The correction is no longer required" } },
    "Cancel the Mission",
  );
  const cancelledModel = deriveMissionFlowModel(cancelled);

  assert.deepEqual(
    {
      changes: {
        visualState: changesModel.visualState,
        currentStage: changesModel.currentStage,
        activeStage: changesModel.stages.find((stage) =>
          ["changes-requested", "blocked", "resumed", "cancelled"].includes(
            stage.state,
          ),
        ),
      },
      blocked: {
        visualState: blockedModel.visualState,
        currentStage: blockedModel.currentStage,
        activeStage: blockedModel.stages.find((stage) =>
          ["changes-requested", "blocked", "resumed", "cancelled"].includes(
            stage.state,
          ),
        ),
      },
      resumed: {
        visualState: resumedModel.visualState,
        currentStage: resumedModel.currentStage,
        activeStage: resumedModel.stages.find((stage) =>
          ["changes-requested", "blocked", "resumed", "cancelled"].includes(
            stage.state,
          ),
        ),
      },
      cancelled: {
        visualState: cancelledModel.visualState,
        currentStage: cancelledModel.currentStage,
        activeStage: cancelledModel.stages.find((stage) =>
          ["changes-requested", "blocked", "resumed", "cancelled"].includes(
            stage.state,
          ),
        ),
      },
    },
    {
      changes: {
        visualState: {
          kind: "changes-requested",
          label: "Changes requested",
          summary: "Review requested an idempotency correction",
          source: "REVIEW",
          priorSafeState: "IN_REVIEW",
        },
        currentStage: {
          status: "CHANGES_REQUESTED",
          label: "Changes requested",
          position: 5,
          total: 9,
        },
        activeStage: {
          status: "IN_REVIEW",
          label: "Review",
          index: 4,
          number: 5,
          state: "changes-requested",
        },
      },
      blocked: {
        visualState: {
          kind: "blocked",
          label: "Blocked",
          summary: "Required replay fixture is unavailable",
          source: "REVIEW",
          priorSafeState: "CHANGES_REQUESTED",
        },
        currentStage: {
          status: "BLOCKED",
          label: "Blocked",
          position: 5,
          total: 9,
        },
        activeStage: {
          status: "IN_REVIEW",
          label: "Review",
          index: 4,
          number: 5,
          state: "blocked",
        },
      },
      resumed: {
        visualState: {
          kind: "resumed",
          label: "Resumed",
          summary: "Replay fixture supplied",
          source: "REVIEW",
          priorSafeState: "CHANGES_REQUESTED",
        },
        currentStage: {
          status: "CHANGES_REQUESTED",
          label: "Resumed",
          position: 5,
          total: 9,
        },
        activeStage: {
          status: "IN_REVIEW",
          label: "Review",
          index: 4,
          number: 5,
          state: "resumed",
        },
      },
      cancelled: {
        visualState: {
          kind: "cancelled",
          label: "Cancelled",
          summary: "The correction is no longer required",
          source: "REVIEW",
          priorSafeState: "CHANGES_REQUESTED",
        },
        currentStage: {
          status: "CANCELLED",
          label: "Cancelled",
          position: 5,
          total: 9,
        },
        activeStage: {
          status: "IN_REVIEW",
          label: "Review",
          index: 4,
          number: 5,
          state: "cancelled",
        },
      },
    },
  );

  const deck = deriveCommandDeckModel([cancelled]);
  assert.deepEqual(
    {
      activeMissions: deck.metrics.activeMissions,
      completedMissions: deck.metrics.completedMissions,
      cancelledMissions: deck.metrics.cancelledMissions,
      missionStatus: deck.missions[0].status,
      lifecycleCompletion: deck.missions[0].lifecycleCompletion,
    },
    {
      activeMissions: 0,
      completedMissions: 0,
      cancelledMissions: 1,
      missionStatus: "CANCELLED",
      lifecycleCompletion: 56,
    },
  );
});

test("Mission Flow surfaces the human rejection rationale at the Approval stage", () => {
  const mission = {
    id: "mission-release-rejected",
    brief: {
      ...brief,
      releaseRequired: true,
      releaseAuthorized: true,
      releaseAuthority: "release-owner",
    },
    status: "CHANGES_REQUESTED",
    contextPackVersion: 1,
    changeRequest: {
      source: "APPROVAL",
      reason: "Rollback evidence needs the database restore procedure",
      evidenceRefs: ["evidence://approval-rejection"],
      requestedAtSequence: 8,
    },
    allowedActions: [
      "start_correction",
      "revise_context",
      "block_mission",
      "cancel_mission",
    ],
    events: [
      event(
        8,
        "RELEASE_REJECTED",
        "2026-07-30T12:30:00.000Z",
        ["evidence://approval-rejection"],
      ),
    ],
  };

  const model = deriveMissionFlowModel(mission);

  assert.deepEqual(
    {
      visualState: model.visualState,
      currentStage: model.currentStage,
      activeStage: model.stages.find(
        (stage) => stage.state === "changes-requested",
      ),
    },
    {
      visualState: {
        kind: "changes-requested",
        label: "Changes requested",
        summary: "Rollback evidence needs the database restore procedure",
        source: "APPROVAL",
        priorSafeState: "APPROVAL_REQUIRED",
      },
      currentStage: {
        status: "CHANGES_REQUESTED",
        label: "Changes requested",
        position: 7,
        total: 11,
      },
      activeStage: {
        status: "APPROVAL_REQUIRED",
        label: "Approval",
        index: 6,
        number: 7,
        state: "changes-requested",
      },
    },
  );

});

test("Approval Room traces current Evidence refs to observable summaries and source events", () => {
  const mission = {
    id: "mission-evidence-trace",
    brief: {
      ...brief,
      releaseRequired: true,
      releaseAuthorized: true,
      releaseAuthority: "release-owner",
    },
    status: "APPROVAL_REQUIRED",
    contextPackVersion: 1,
    releaseReadiness: {
      candidate: {
        name: "release-42",
        uri: "artifact://release-42",
        diff: "diff",
      },
      candidateArtifacts: [
        { name: "release-42", uri: "artifact://release-42", diff: "diff" },
      ],
      contextPackVersion: 1,
      evidenceRefs: ["evidence://run", "evidence://review"],
      residualRisk: "Rollback may be required",
      intendedExternalAction: "Deploy release-42",
      rollbackCommitment: "Restore release-41",
    },
    allowedActions: ["approve_release", "reject_release"],
    events: [
      {
        ...event(4, "AGENT_RUN_COMPLETED", "2026-08-04T12:00:00.000Z", [
          "evidence://run",
        ]),
        data: {
          run: {
            evidence: [
              {
                ref: "evidence://run",
                kind: "inspection",
                summary: "Run captured the exact diff",
                checks: ["diff present"],
              },
            ],
          },
        },
      },
      {
        ...event(5, "REVIEW_PASSED", "2026-08-04T12:01:00.000Z", [
          "evidence://review",
        ]),
        data: {
          review: {
            summary: "Independent review passed",
            details: {
              reviewer: "sol-reviewer",
              findings: [],
            },
          },
        },
      },
    ],
  };

  const model = deriveApprovalRoomModel(mission);

  assert.deepEqual(model.evidenceDetails, [
    {
      ref: "evidence://run",
      kind: "inspection",
      summary: "Run captured the exact diff",
      sourceEventType: "AGENT_RUN_COMPLETED",
      sourceSequence: 4,
      details: { checks: ["diff present"] },
    },
    {
      ref: "evidence://review",
      kind: "REVIEW_PASSED",
      summary: "Independent review passed",
      sourceEventType: "REVIEW_PASSED",
      sourceSequence: 5,
      details: { reviewer: "sol-reviewer", findings: [] },
    },
  ]);

  const approvedModel = deriveApprovalRoomModel({
    ...mission,
    status: "READY_TO_RELEASE",
    events: [
      ...mission.events,
      {
        ...event(
          6,
          "RELEASE_APPROVED",
          "2026-08-04T12:02:00.000Z",
          ["evidence://run", "evidence://review"],
        ),
        data: {
          approval: {
            decision: "APPROVED",
            summary: "Approved after inspecting the current evidence",
          },
        },
      },
    ],
  });

  assert.equal(approvedModel.evidenceDetails[0].summary, "Run captured the exact diff");
  assert.equal(approvedModel.evidenceDetails[1].summary, "Independent review passed");

  const artifactModel = deriveApprovalRoomModel({
    ...mission,
    releaseReadiness: {
      ...mission.releaseReadiness,
      evidenceRefs: ["evidence://artifact"],
    },
    events: [
      {
        ...event(3, "ARTIFACT_SUBMITTED", "2026-08-04T11:59:00.000Z", [
          "evidence://artifact",
        ]),
        data: {
          artifact: {
            name: "release-42",
            uri: "artifact://release-42",
            diff: "@@ release-42 @@\n+candidate content",
          },
        },
      },
    ],
  });

  assert.deepEqual(artifactModel.evidenceDetails[0], {
    ref: "evidence://artifact",
    kind: "artifact",
    summary: "Record ARTIFACT_SUBMITTED",
    sourceEventType: "ARTIFACT_SUBMITTED",
    sourceSequence: 3,
    details: { diff: "@@ release-42 @@\n+candidate content" },
  });

  const rejectedMission = {
    ...mission,
    status: "CHANGES_REQUESTED",
    releaseReadiness: null,
    approval: {
      decision: "REJECTED",
      summary: "Regenerate the candidate with a clearer rollback proof",
      ...mission.releaseReadiness,
    },
    allowedActions: ["start_correction", "revise_context"],
    events: [
      ...mission.events,
      {
        ...event(
          6,
          "RELEASE_REJECTED",
          "2026-08-04T12:02:00.000Z",
          ["evidence://run", "evidence://review"],
        ),
        data: {
          approval: {
            decision: "REJECTED",
            summary: "Regenerate the candidate with a clearer rollback proof",
            ...mission.releaseReadiness,
          },
        },
      },
    ],
  };
  const rejectedModel = deriveApprovalRoomModel(rejectedMission);
  assert.deepEqual(
    {
      status: rejectedModel.status,
      decision: rejectedModel.decision,
      candidate: rejectedModel.candidate,
      canApprove: rejectedModel.canApprove,
      canReject: rejectedModel.canReject,
    },
    {
      status: "CHANGES_REQUESTED",
      decision: "REJECTED",
      candidate: mission.releaseReadiness.candidate,
      canApprove: false,
      canReject: false,
    },
  );
});

test("Review Ledger derives the exact current release decision without inventing deployment", async () => {
  let generatedId = 0;
  const orchestrator = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    agentRouter: createReleaseRouter(),
    clock: () => "2026-07-30T13:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-release" : `event-${++generatedId}`,
  });
  const created = orchestrator.createMission({
    brief: {
      ...brief,
      releaseRequired: true,
      releaseAuthorized: true,
      releaseAuthority: "release-owner",
      mutationAuthority: "workspace-write:codex-mission-control/src",
      releasePlan: {
        residualRisk: "A failed rollout may require rollback",
        intendedExternalAction: "Deploy the approved build",
        rollbackCommitment: "Restore release 41",
        requiredValidationGates: ["unit-tests", "integration-tests"],
      },
    },
    actor: "mission-owner",
    reason: "Create release Mission",
  });
  const execute = (
    type,
    payload,
    reason,
    evidenceRefs = [],
    actor = "mission-owner",
  ) =>
    orchestrator.execute(created.id, {
      type,
      payload,
      actor,
      reason,
      evidenceRefs,
    });
  execute(
    "CAPTURE_CONTEXT",
    { context: sourceBackedContext("Release Context") },
    "Capture Context",
  );
  execute(
    "ACCEPT_PLAN",
    {
      plan: {
        steps: ["build", "review", "validate"],
        taskGraph: releaseTaskGraph(),
      },
    },
    "Accept plan",
  );
  await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the release candidate through transport",
  });
  await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the declared release validation gates",
  });
  const reviewedMission = await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the independent release reviewer",
  });
  const reviewer = reviewedMission.execution.nodes.find(
    (node) => node.assignment.id === "review-release-candidate",
  );
  execute(
    "PASS_REVIEW",
    {
      review: {
        summary: "Review passed",
        reviewerAssignmentId: reviewer.assignment.id,
        outcome: reviewer.reviewOutcome.outcome,
        candidateArtifactRefs: reviewer.reviewOutcome.candidateArtifactRefs,
        findings: reviewer.reviewOutcome.findings,
      },
    },
    "Pass review",
    reviewer.evidenceRefs,
    "agent:sol_reviewer",
  );
  const pendingMission = execute(
    "PASS_VALIDATION",
    {
      validation: {
        summary: "Validation passed",
        gates: [
          {
            type: "unit-tests",
            status: "PASSED",
            outcome: "PASSED",
            evidenceRef: "evidence://validation-unit-tests",
          },
          {
            type: "integration-tests",
            status: "PASSED",
            outcome: "PASSED",
            evidenceRef: "evidence://validation-integration-tests",
          },
        ],
      },
    },
    "Pass validation",
    [
      "evidence://validation-unit-tests",
      "evidence://validation-integration-tests",
    ],
  );

  const pending = deriveApprovalRoomModel(pendingMission);
  const approvedMission = orchestrator.execute(created.id, {
    type: "APPROVE_RELEASE",
    payload: { approval: { summary: "Approve release 42" } },
    actor: "release-owner",
    reason: "Accept current residual risk",
    evidenceRefs: pendingMission.releaseReadiness.evidenceRefs,
  });
  const approved = deriveApprovalRoomModel(approvedMission);

  assert.deepEqual(
    {
      pending: {
        status: pending.status,
        candidate: pending.candidate,
        candidateArtifacts: pending.candidateArtifacts,
        evidence: pending.evidence,
        residualRisk: pending.residualRisk,
        intendedExternalAction: pending.intendedExternalAction,
        rollbackCommitment: pending.rollbackCommitment,
        releaseAuthority: pending.releaseAuthority,
        canApprove: pending.canApprove,
        canReject: pending.canReject,
        externalActionExecuted: pending.externalActionExecuted,
      },
      approved: {
        status: approved.status,
        canApprove: approved.canApprove,
        canReject: approved.canReject,
        decisionHistory: approved.decisionHistory,
        externalActionExecuted: approved.externalActionExecuted,
      },
    },
    {
      pending: {
        status: "APPROVAL_REQUIRED",
        candidate: {
          name: "release-42",
          uri: "artifact://release-42",
          diff: "@@ release-42 @@\n+candidate content",
        },
        candidateArtifacts: [
          {
            name: "release-42",
            uri: "artifact://release-42",
            diff: "@@ release-42 @@\n+candidate content",
          },
        ],
        evidence: [
          "evidence://artifact-42",
          "evidence://review-42",
          "evidence://validation-unit-tests",
          "evidence://validation-integration-tests",
        ],
        residualRisk: "A failed rollout may require rollback",
        intendedExternalAction: "Deploy the approved build",
        rollbackCommitment: "Restore release 41",
        releaseAuthority: "release-owner",
        canApprove: true,
        canReject: true,
        externalActionExecuted: false,
      },
      approved: {
        status: "READY_TO_RELEASE",
        canApprove: false,
        canReject: false,
        decisionHistory: [
          {
            sequence: pendingMission.events.length + 1,
            type: "RELEASE_APPROVED",
            actor: "release-owner",
            reason: "Accept current residual risk",
            occurredAt: "2026-07-30T13:00:00.000Z",
            decision: "APPROVED",
            summary: "Approve release 42",
            evidenceRefs: [
              "evidence://artifact-42",
              "evidence://review-42",
              "evidence://validation-unit-tests",
              "evidence://validation-integration-tests",
            ],
          },
        ],
        externalActionExecuted: false,
      },
    },
  );
});

test("Mission Flow derives Task Graph, agent cards, Decision Rooms, and Activity only from replayed execution events", () => {
  const mission = {
    id: "mission-execution",
    brief,
    status: "RUNNING",
    contextPackVersion: 1,
    allowedActions: ["dispatch_execution_wave"],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      workerCapacity: 3,
      availableWorkerSlots: 3,
      frontier: ["review-output"],
      activeAssignmentIds: [],
      decisionRequiredAssignmentIds: [],
      nodes: [
        {
          assignment: {
            id: "build-output",
            goal: "Build the execution-wave module",
            effectivePermission: "workspace-write",
          },
          dependsOn: [],
          requiresDecision: false,
          status: "COMPLETED",
          agent: {
            roleId: "terra_builder",
            roleName: "Terra Builder",
            capability: "implementation",
            effectivePermission: "workspace-write",
          },
          run: {
            id: "run-build",
            status: "COMPLETED",
            startedAt: "2026-08-08T09:00:00.000Z",
            updatedAt: "2026-08-08T09:02:00.000Z",
            evidence: [
              {
                ref: "evidence://build-output",
                kind: "test",
                summary: "Execution contracts passed",
              },
            ],
          },
          artifacts: [{ uri: "artifact://build-output" }],
          evidenceRefs: ["evidence://build-output"],
        },
        {
          assignment: {
            id: "review-output",
            goal: "Review the execution-wave module",
            effectivePermission: "read-only",
          },
          dependsOn: ["build-output"],
          requiresDecision: false,
          status: "PENDING",
          agent: null,
          run: null,
          artifacts: [],
          evidenceRefs: [],
        },
      ],
      waves: [
        {
          id: "wave-1",
          capacity: 4,
          reservedSlots: 1,
          workerCapacity: 3,
          assignmentIds: ["build-output"],
          serializedAssignmentIds: [],
          deferredAssignmentIds: [],
          status: "COMPLETED",
        },
      ],
      decisionRooms: [
        {
          id: "decision-room:seam",
          assignmentId: "build-output",
          question: "Which seam owns wave invariants?",
          participantRoles: ["orchestrator", "sol_architect"],
          alternatives: [
            {
              id: "module",
              label: "Deep module",
              tradeoffs: ["Extra file", "Single replay policy"],
            },
            {
              id: "inline",
              label: "Inline",
              tradeoffs: ["Fewer files", "Larger Orchestrator"],
            },
          ],
          recommendation: {
            alternativeId: "module",
            rationale: "Keep replay policy local",
          },
          validationPlan: ["Replay forged events"],
          inputEvidenceRefs: ["evidence://seam-options"],
          status: "RESOLVED",
          decision: {
            selectedAlternativeId: "module",
            rationale: "Replay safety wins",
            actor: "mission-owner",
          },
        },
      ],
    },
    events: [
      {
        ...event(1, "MISSION_CREATED", "2026-08-08T08:55:00.000Z"),
        missionId: "mission-execution",
      },
      {
        ...event(2, "EXECUTION_WAVE_DISPATCHED", "2026-08-08T09:00:00.000Z"),
        missionId: "mission-execution",
        actor: "mission-owner",
        reason: "Dispatch safe wave",
        data: {
          wave: { id: "wave-1", assignmentIds: ["build-output"] },
        },
      },
      {
        ...event(3, "EXECUTION_RUN_STARTED", "2026-08-08T09:00:00.000Z"),
        missionId: "mission-execution",
        actor: "agent:terra_builder",
        reason: "Started build-output",
        data: { assignmentId: "build-output", waveId: "wave-1" },
      },
      {
        ...event(
          4,
          "EXECUTION_RUN_COMPLETED",
          "2026-08-08T09:02:00.000Z",
          ["evidence://build-output"],
        ),
        missionId: "mission-execution",
        actor: "agent:terra_builder",
        reason: "Completed build-output",
        data: { assignmentId: "build-output", waveId: "wave-1" },
      },
      {
        ...event(5, "DECISION_ROOM_RESOLVED", "2026-08-08T09:03:00.000Z"),
        missionId: "mission-execution",
        actor: "mission-owner",
        reason: "Resolved execution seam",
        data: { decision: { roomId: "decision-room:seam" } },
      },
    ],
  };

  const model = deriveMissionFlowModel(mission);
  const terra = model.team.find((role) => role.id === "terra_builder");

  assert.deepEqual(model.execution.summary, {
    capacity: 4,
    reservedSlots: 1,
    workerCapacity: 3,
    availableWorkerSlots: 3,
    completedAssignments: 1,
    totalAssignments: 2,
  });
  assert.deepEqual(
    model.execution.nodes.map((node) => ({
      id: node.id,
      dependsOn: node.dependsOn,
      status: node.status,
      roleId: node.roleId,
      latestEvidence: node.latestEvidence,
    })),
    [
      {
        id: "build-output",
        dependsOn: [],
        status: "COMPLETED",
        roleId: "terra_builder",
        latestEvidence: "evidence://build-output",
      },
      {
        id: "review-output",
        dependsOn: ["build-output"],
        status: "PENDING",
        roleId: null,
        latestEvidence: null,
      },
    ],
  );
  assert.deepEqual(model.execution.frontier, ["review-output"]);
  assert.equal(model.execution.decisionRooms[0].status, "RESOLVED");
  assert.deepEqual(
    model.execution.activity.map((item) => ({
      sequence: item.sequence,
      type: item.type,
      actor: item.actor,
      assignmentId: item.assignmentId,
      evidenceRefs: item.evidenceRefs,
    })),
    [
      {
        sequence: 5,
        type: "DECISION_ROOM_RESOLVED",
        actor: "mission-owner",
        assignmentId: "build-output",
        evidenceRefs: [],
      },
      {
        sequence: 4,
        type: "EXECUTION_RUN_COMPLETED",
        actor: "agent:terra_builder",
        assignmentId: "build-output",
        evidenceRefs: ["evidence://build-output"],
      },
      {
        sequence: 3,
        type: "EXECUTION_RUN_STARTED",
        actor: "agent:terra_builder",
        assignmentId: "build-output",
        evidenceRefs: [],
      },
      {
        sequence: 2,
        type: "EXECUTION_WAVE_DISPATCHED",
        actor: "mission-owner",
        assignmentId: null,
        evidenceRefs: [],
      },
    ],
  );
  assert.deepEqual(
    {
      connection: terra.connection,
      assignment: terra.assignment,
      runtimeStatus: terra.runtimeStatus,
      latestEvidence: terra.latestEvidence,
    },
    {
      connection: "Observed",
      assignment: "Build the execution-wave module",
      runtimeStatus: "COMPLETED",
      latestEvidence: "evidence://build-output",
    },
  );
});
