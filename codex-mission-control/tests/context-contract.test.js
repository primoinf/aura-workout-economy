import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryEventStore,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";
import { createAgentRoutingAdapter } from "../src/agent-routing-adapter.js";

function createBriefMission({ agentRouter } = {}) {
  let eventNumber = 0;
  const orchestrator = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    agentRouter,
    clock: () => "2026-08-29T03:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-context-contract" : `event-${++eventNumber}`,
  });
  const mission = orchestrator.createMission({
    brief: {
      goal: "Route only source-backed workspace Context",
      scope: "The Context Pack command boundary",
      acceptanceCriteria: ["Placeholder Context never reaches an agent"],
      constraints: ["Every fact names an available source"],
      risk: "medium",
      mutationAuthority: "workspace-write:codex-mission-control",
      releaseRequired: false,
      releaseAuthority: "mission-owner",
    },
    actor: "mission-owner",
    reason: "Create a Mission awaiting source-backed Context",
  });
  return { mission, orchestrator };
}

function sourceBackedContext() {
  return {
    summary: "Captured current Mission workspace Context",
    capturedAt: "2026-08-29T02:59:00.000Z",
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
        statement: "TASK-050 is the active Mission Control remediation.",
        sourceRefs: ["workspace://task-board.md#TASK-050"],
      },
    ],
    assumptions: [],
  };
}

test("Mission Orchestrator rejects placeholder-only Context before CONTEXT_READY", () => {
  const { mission, orchestrator } = createBriefMission();

  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "CAPTURE_CONTEXT",
        payload: {
          context: {
            summary: "Caller-authored placeholder Context",
          },
        },
        actor: "mission-owner",
        reason: "Attempt to persist an untraceable Context Pack",
      }),
    /source-backed Context Pack/i,
  );

  const unchanged = orchestrator.getMission(mission.id);
  assert.equal(unchanged.status, "BRIEF_ACCEPTED");
  assert.equal(unchanged.events.length, 1);
});

test("accepted plans bind Assignment context to the active source-backed Context Pack", () => {
  const { mission, orchestrator } = createBriefMission();
  const capturedContext = sourceBackedContext();
  orchestrator.execute(mission.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: capturedContext },
    actor: "mission-owner",
    reason: "Persist the source-backed Context Pack",
  });

  const planned = orchestrator.execute(mission.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        steps: ["Route one bounded Assignment"],
        assignment: {
          id: "caller-authored-context",
          goal: "Inspect only the active Context Pack",
          acceptanceCriteria: ["The routed Context is source-backed"],
          contextSlice: {
            summary: "Caller-authored placeholder",
            sourceRefs: ["caller://untrusted"],
          },
          ownershipBoundary: {
            readPaths: ["codex-mission-control/src"],
            writePaths: [],
          },
          effectivePermission: "read-only",
          budget: { maxTurns: 1, maxMinutes: 1 },
          expectedEvidence: ["Source-backed Context inspection"],
          workKind: "deterministic",
          risk: "low",
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept a bounded Plan",
  });

  assert.deepEqual(planned.plan.assignment.contextSlice, {
    ...capturedContext,
    contextPackVersion: 1,
    sourceRefs: capturedContext.sources.map((source) => source.ref),
  });
});

test("Context revision rejects placeholder input and preserves the active Context Pack", () => {
  const { mission, orchestrator } = createBriefMission();
  const capturedContext = sourceBackedContext();
  const ready = orchestrator.execute(mission.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: capturedContext },
    actor: "mission-owner",
    reason: "Persist the source-backed Context Pack",
  });

  assert.throws(
    () =>
      orchestrator.execute(mission.id, {
        type: "REVISE_CONTEXT",
        payload: { context: { summary: "Untraceable revision" } },
        actor: "mission-owner",
        reason: "Attempt to replace Context without source observations",
      }),
    /source-backed Context Pack/i,
  );

  const unchanged = orchestrator.getMission(mission.id);
  assert.equal(unchanged.status, "CONTEXT_READY");
  assert.equal(unchanged.contextPackVersion, 1);
  assert.deepEqual(unchanged.context, ready.context);
});

test("Task Graph Assignments all receive the canonical active Context Pack", () => {
  const { mission, orchestrator } = createBriefMission();
  orchestrator.execute(mission.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: sourceBackedContext() },
    actor: "mission-owner",
    reason: "Persist the source-backed Context Pack",
  });
  const assignment = (id, overrides = {}) => ({
    id,
    goal: `Inspect Context for ${id}`,
    acceptanceCriteria: ["The routed Context is source-backed"],
    contextSlice: {
      summary: "Caller-authored placeholder",
      sourceRefs: ["caller://untrusted"],
    },
    ownershipBoundary: {
      readPaths: ["codex-mission-control/src"],
      writePaths: [],
    },
    effectivePermission: "read-only",
    budget: { maxTurns: 1, maxMinutes: 1 },
    expectedEvidence: ["Source-backed Context inspection"],
    workKind: "deterministic",
    risk: "low",
    dependsOn: [],
    ...overrides,
  });

  const planned = orchestrator.execute(mission.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        steps: ["Route two bounded Assignments"],
        taskGraph: {
          capacity: 2,
          coordinationRequired: true,
          assignments: [
            assignment("inspect-a"),
            assignment("review-context", {
              workKind: "review",
              risk: "high",
              dependsOn: ["inspect-a"],
            }),
          ],
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept a bounded Task Graph",
  });

  for (const node of planned.execution.nodes) {
    assert.deepEqual(node.assignment.contextSlice, planned.context);
  }
});

test("schema-3 replay rejects a Plan whose Assignment Context was forged", () => {
  const { mission, orchestrator } = createBriefMission();
  const ready = orchestrator.execute(mission.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: sourceBackedContext() },
    actor: "mission-owner",
    reason: "Persist the source-backed Context Pack",
  });
  const forgedPlanEvent = {
    schemaVersion: 3,
    id: "event-forged-plan-context",
    missionId: mission.id,
    sequence: ready.events.length + 1,
    type: "PLAN_ACCEPTED",
    actor: "malformed-history",
    occurredAt: "2026-08-29T03:01:00.000Z",
    reason: "Forge caller-authored Assignment Context",
    contextPackVersion: ready.contextPackVersion,
    evidenceRefs: [],
    data: {
      plan: {
        steps: ["Route one forged Assignment"],
        assignment: {
          id: "forged-context",
          contextSlice: {
            summary: "Caller-authored placeholder",
            sourceRefs: ["caller://untrusted"],
          },
        },
      },
    },
  };
  const replay = createMissionOrchestrator({
    eventStore: createMemoryEventStore({
      [mission.id]: [...ready.events, forgedPlanEvent],
    }),
  });

  assert.throws(
    () => replay.getMission(mission.id),
    /Assignment context must match the active source-backed Context Pack/i,
  );
});

test("legacy dispatch replaces caller-authored Assignment Context before transport", async () => {
  let observedAssignment;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        observedAssignment = structuredClone(request.assignment);
        yield {
          kind: "started",
          runId: "run-context-contract",
          occurredAt: "2026-08-29T03:02:00.000Z",
        };
        yield {
          kind: "completed",
          runId: "run-context-contract",
          occurredAt: "2026-08-29T03:03:00.000Z",
          summary: "Inspected the canonical Context Pack",
          artifacts: [
            {
              name: "context-inspection",
              uri: "artifact://context-inspection",
            },
          ],
          evidence: [
            {
              ref: "evidence://context-inspection",
              kind: "inspection",
              summary: "Observed canonical Context Pack",
            },
          ],
        };
      },
    },
  });
  const { mission, orchestrator } = createBriefMission({ agentRouter });
  orchestrator.execute(mission.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: sourceBackedContext() },
    actor: "mission-owner",
    reason: "Persist the source-backed Context Pack",
  });
  const planned = orchestrator.execute(mission.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { steps: ["Route one bounded Assignment"] } },
    actor: "mission-owner",
    reason: "Accept a bounded Plan",
  });
  const callerAssignment = {
    id: "legacy-context-dispatch",
    goal: "Inspect only the active Context Pack",
    acceptanceCriteria: ["The routed Context is source-backed"],
    contextSlice: {
      summary: "Caller-authored placeholder",
      sourceRefs: ["caller://untrusted"],
    },
    ownershipBoundary: {
      readPaths: ["codex-mission-control/src"],
      writePaths: [],
    },
    effectivePermission: "read-only",
    budget: { maxTurns: 1, maxMinutes: 1 },
    expectedEvidence: ["Source-backed Context inspection"],
    workKind: "deterministic",
    risk: "low",
  };

  await orchestrator.dispatchAssignment(mission.id, {
    assignment: callerAssignment,
    actor: "mission-owner",
    reason: "Route one bounded Assignment",
  });

  assert.deepEqual(observedAssignment.contextSlice, planned.context);
});
