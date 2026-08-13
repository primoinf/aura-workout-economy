import assert from "node:assert/strict";
import test from "node:test";

import { createAgentRoutingAdapter } from "../src/agent-routing-adapter.js";

const boundedAssignment = {
  id: "assignment-001",
  goal: "Summarize the Mission event types",
  acceptanceCriteria: ["Return every current event type exactly once"],
  contextSlice: {
    summary: "Inspect only the Mission Orchestrator source",
    sourceRefs: ["src/mission-orchestrator.js"],
  },
  ownershipBoundary: {
    readPaths: ["src/mission-orchestrator.js"],
    writePaths: [],
  },
  effectivePermission: "read-only",
  budget: {
    maxTurns: 2,
    maxMinutes: 5,
  },
  expectedEvidence: ["A sorted list of event type names"],
  workKind: "deterministic",
  risk: "low",
};

test("routing selects the smallest capable role from capability, risk, and bounded permission", () => {
  const adapter = createAgentRoutingAdapter({
    transport: { run: async function* () {} },
  });

  const routing = adapter.route(boundedAssignment);

  assert.deepEqual(routing, {
    assignment: boundedAssignment,
    agent: {
      roleId: "luna_worker",
      roleName: "Luna Worker",
      capability: "deterministic",
      effectivePermission: "read-only",
    },
  });
});

test("routing rejects an incomplete or internally inconsistent Assignment", () => {
  const adapter = createAgentRoutingAdapter({
    transport: { run: async function* () {} },
  });

  assert.throws(
    () => adapter.route({ ...boundedAssignment, expectedEvidence: [] }),
    /Assignment expectedEvidence must contain at least one item/,
  );
  assert.throws(
    () =>
      adapter.route({
        ...boundedAssignment,
        effectivePermission: "read-only",
        ownershipBoundary: {
          readPaths: ["src/mission-orchestrator.js"],
          writePaths: ["src/main.js"],
        },
      }),
    /read-only Assignment cannot declare writable ownership/,
  );
  assert.throws(
    () =>
      adapter.route({
        ...boundedAssignment,
        budget: { maxTurns: 0, maxMinutes: 5 },
      }),
    /Assignment budget maxTurns must be a positive integer/,
  );
  assert.throws(
    () =>
      adapter.route({
        ...boundedAssignment,
        ownershipBoundary: {
          readPaths: ["../outside-workspace"],
          writePaths: [],
        },
      }),
    /ownershipBoundary readPaths must use bounded relative paths/,
  );
});

test("routing lowers effective permission when the capable role is read-only", () => {
  const adapter = createAgentRoutingAdapter({
    transport: { run: async function* () {} },
  });

  const routing = adapter.route({
    ...boundedAssignment,
    workKind: "implementation",
    risk: "high",
    effectivePermission: "workspace-write",
    ownershipBoundary: {
      readPaths: ["src/mission-orchestrator.js"],
      writePaths: ["src/mission-orchestrator.js"],
    },
  });

  assert.deepEqual(
    {
      roleId: routing.agent.roleId,
      assignmentPermission: routing.assignment.effectivePermission,
      agentPermission: routing.agent.effectivePermission,
      writableOwnership: routing.assignment.ownershipBoundary.writePaths,
    },
    {
      roleId: "sol_architect",
      assignmentPermission: "read-only",
      agentPermission: "read-only",
      writableOwnership: [],
    },
  );
});

test("adapter exposes normalized live Run observations without treating spawn as completion", async () => {
  const transportRequests = [];
  const transport = {
    async *run(request) {
      transportRequests.push(request);
      yield {
        kind: "started",
        runId: "run-001",
        occurredAt: "2026-07-30T08:00:00.000Z",
        model: { name: "observable-model", reasoningEffort: "medium" },
      };
      yield {
        kind: "progress",
        runId: "run-001",
        occurredAt: "2026-07-30T08:01:00.000Z",
        summary: "Inspected the bounded source file",
      };
      yield {
        kind: "completed",
        runId: "run-001",
        occurredAt: "2026-07-30T08:02:00.000Z",
        summary: "Returned the requested event inventory",
        artifacts: [
          {
            name: "event-inventory",
            uri: "artifact://event-inventory",
          },
        ],
        evidence: [
          {
            ref: "evidence://event-inventory",
            kind: "inspection",
            summary: "Sorted event names from the bounded source",
          },
        ],
      };
    },
  };
  const adapter = createAgentRoutingAdapter({ transport });
  const routing = adapter.route(boundedAssignment);
  const observations = [];

  for await (const observation of adapter.run(routing)) {
    observations.push(observation);
  }

  assert.deepEqual(transportRequests, [
    {
      roleId: "luna_worker",
      permission: "read-only",
      assignment: boundedAssignment,
    },
  ]);
  assert.deepEqual(observations, [
    {
      type: "RUN_STARTED",
      runId: "run-001",
      status: "WORKING",
      occurredAt: "2026-07-30T08:00:00.000Z",
      modelMetadata: {
        name: "observable-model",
        reasoningEffort: "medium",
      },
    },
    {
      type: "RUN_UPDATED",
      runId: "run-001",
      status: "WORKING",
      occurredAt: "2026-07-30T08:01:00.000Z",
      summary: "Inspected the bounded source file",
    },
    {
      type: "RUN_COMPLETED",
      runId: "run-001",
      status: "COMPLETED",
      occurredAt: "2026-07-30T08:02:00.000Z",
      summary: "Returned the requested event inventory",
      artifacts: [
        {
          name: "event-inventory",
          uri: "artifact://event-inventory",
        },
      ],
      evidence: [
        {
          ref: "evidence://event-inventory",
          kind: "inspection",
          summary: "Sorted event names from the bounded source",
        },
      ],
    },
  ]);
});

test("routing covers every Ticket 05 role and makes independent review read-only", () => {
  const adapter = createAgentRoutingAdapter({
    transport: { run: async function* () {} },
  });
  const route = (workKind, risk, overrides = {}) =>
    adapter.route({
      ...boundedAssignment,
      workKind,
      risk,
      ...overrides,
    });

  assert.deepEqual(
    [
      route("deterministic", "low").agent.roleId,
      route("implementation", "medium").agent.roleId,
      route("debugging", "high").agent.roleId,
      route("architecture", "critical").agent.roleId,
      route("review", "high").agent.roleId,
    ],
    [
      "luna_worker",
      "terra_builder",
      "terra_debugger",
      "sol_architect",
      "sol_reviewer",
    ],
  );

  const reviewer = route("review", "high", {
    effectivePermission: "workspace-write",
    ownershipBoundary: {
      readPaths: ["src/mission-orchestrator.js"],
      writePaths: ["src/task-graph-execution.js"],
    },
  });
  assert.deepEqual(
    {
      roleId: reviewer.agent.roleId,
      independent: reviewer.agent.independent,
      effectivePermission: reviewer.agent.effectivePermission,
      readPaths: reviewer.assignment.ownershipBoundary.readPaths,
      writePaths: reviewer.assignment.ownershipBoundary.writePaths,
    },
    {
      roleId: "sol_reviewer",
      independent: true,
      effectivePermission: "read-only",
      readPaths: [
        "src/mission-orchestrator.js",
        "src/task-graph-execution.js",
      ],
      writePaths: [],
    },
  );
});
