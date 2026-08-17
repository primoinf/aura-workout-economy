import assert from "node:assert/strict";
import test from "node:test";

import { createAgentRoutingAdapter } from "../src/agent-routing-adapter.js";
import { renderTaskExecutionContent } from "../src/execution-room-view.js";
import {
  createLocalStorageEventStore,
  createMemoryEventStore,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";
import { deriveMissionFlowModel } from "../src/mission-presenter.js";

const brief = {
  goal: "Coordinate bounded Task Graph execution",
  scope: "Task Graph execution contracts",
  acceptanceCriteria: ["Execution remains replay-safe"],
  constraints: ["Do not deploy"],
  risk: "medium",
  mutationAuthority: "workspace-write:src",
  releaseRequired: false,
  releaseAuthority: "mission-owner",
};

const assignment = {
  id: "inspect-graph",
  goal: "Inspect the Task Graph",
  acceptanceCriteria: ["Report the current frontier"],
  contextSlice: {
    summary: "Inspect the execution module",
    sourceRefs: ["src/task-graph-execution.js"],
  },
  ownershipBoundary: {
    readPaths: ["src/task-graph-execution.js"],
    writePaths: [],
  },
  effectivePermission: "read-only",
  budget: { maxTurns: 2, maxMinutes: 5 },
  expectedEvidence: ["Frontier Evidence"],
  workKind: "deterministic",
  risk: "low",
};

function task(id, overrides = {}) {
  return {
    ...structuredClone(assignment),
    id,
    goal: `Complete ${id}`,
    dependsOn: [],
    ...structuredClone(overrides),
  };
}

function createIds() {
  const counts = new Map();
  return (kind) => {
    const next = (counts.get(kind) ?? 0) + 1;
    counts.set(kind, next);
    return `${kind}-${next}`;
  };
}

function createImmediateRouter() {
  return createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const id = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${id}`,
          occurredAt: "2026-08-08T11:00:00.000Z",
        };
        yield {
          kind: "completed",
          runId: `run:${id}`,
          occurredAt: "2026-08-08T11:01:00.000Z",
          summary: `Completed ${id}`,
          artifacts: [
            {
              name: id,
              uri: `artifact://${id}`,
              ...(request.roleId === "sol_reviewer"
                ? {
                    reviewOutcome: {
                      outcome: "PASSED",
                      candidateArtifactRefs:
                        request.reviewContext?.candidateArtifactRefs ?? [],
                      findings: [],
                    },
                  }
                : {}),
            },
          ],
          evidence: [
            {
              ref: `evidence://${id}`,
              kind: "test",
              summary: `Observed ${id}`,
            },
          ],
        };
      },
    },
  });
}

function createHarness(
  agentRouter = createImmediateRouter(),
  eventStore = createMemoryEventStore(),
) {
  return createMissionOrchestrator({
    eventStore,
    agentRouter,
    createId: createIds(),
    clock: () => "2026-08-08T11:00:00.000Z",
  });
}

function createStorageEventTarget() {
  const listeners = new Set();
  return {
    addEventListener(type, listener) {
      if (type === "storage") listeners.add(listener);
    },
    removeEventListener(type, listener) {
      if (type === "storage") listeners.delete(listener);
    },
    dispatchStorage(event) {
      for (const listener of listeners) listener(event);
    },
  };
}

function createPlannedMission(orchestrator, id, assignments = [task(id)]) {
  const plannedAssignments = assignments.some(
    (assignment) => assignment.workKind === "review",
  )
    ? assignments
    : [
        ...assignments,
        task(`review-${id}`, {
          dependsOn: assignments.map((assignment) => assignment.id),
          workKind: "review",
          risk: "high",
        }),
      ];
  const created = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: `Create ${id}`,
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary: `Context for ${id}` } },
    actor: "mission-owner",
    reason: `Capture Context for ${id}`,
  });
  orchestrator.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        taskGraph: {
          capacity: 4,
          coordinationRequired: true,
          assignments: plannedAssignments,
        },
      },
    },
    actor: "mission-owner",
    reason: `Accept Task Graph for ${id}`,
  });
  return orchestrator.getMission(created.id);
}

test("Mission blocking rejects an empty attempted-alternatives record", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a Mission for block contract validation",
  });

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "BLOCK_MISSION",
        payload: {
          block: {
            blocker: "Required input is unavailable",
            attemptedAlternatives: [],
            requiredAuthorityOrInput: "Mission owner input",
          },
        },
        actor: "mission-owner",
        reason: "Reject an incomplete block record",
      }),
    /requires blocker, attempted alternatives, and required authority or input/,
  );
  assert.equal(orchestrator.getMission(created.id).events.length, 1);
});

test("Task Graph and legacy single-Assignment lifecycles cannot be mixed", async () => {
  const orchestrator = createHarness();
  const planned = createPlannedMission(orchestrator, "graph-task");

  await assert.rejects(
    orchestrator.dispatchAssignment(planned.id, {
      assignment,
      actor: "mission-owner",
      reason: "Attempt a legacy dispatch on a Task Graph Mission",
    }),
    /legacy Assignment dispatch is unavailable for a Task Graph Mission/,
  );
  assert.throws(
    () =>
      orchestrator.execute(planned.id, {
        type: "START_RUN",
        payload: { run: { id: "legacy-run", status: "WORKING" } },
        actor: "mission-owner",
        reason: "Attempt to start a legacy Run",
      }),
    /Legacy Run commands are unavailable for a Task Graph Mission/,
  );

  const revised = orchestrator.execute(planned.id, {
    type: "REVISE_CONTEXT",
    payload: { context: { summary: "Replace the Task Graph Context" } },
    actor: "mission-owner",
    reason: "Replace the Task Graph with a legacy plan",
  });
  assert.equal(revised.execution, null);
  const legacyPlanned = orchestrator.execute(planned.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { summary: "One bounded legacy Assignment" } },
    actor: "mission-owner",
    reason: "Accept the legacy plan",
  });
  assert.equal(legacyPlanned.execution, null);

  const completed = await orchestrator.dispatchAssignment(planned.id, {
    assignment,
    actor: "mission-owner",
    reason: "Dispatch the replacement legacy Assignment",
  });
  assert.equal(completed.status, "IN_REVIEW");
});

test("Task Graph wave replay fails closed when durable transport tracking is missing", async () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(createImmediateRouter(), eventStore);
  const planned = createPlannedMission(orchestrator, "tracked-wave");
  const completed = await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Record a durable tracked wave",
  });
  const forgedEvents = structuredClone(completed.events);
  const waveEvent = forgedEvents.find(
    (event) => event.type === "EXECUTION_WAVE_DISPATCHED",
  );
  delete waveEvent.data.transportReservationsTracked;

  assert.throws(
    () =>
      createHarness(
        createImmediateRouter(),
        createMemoryEventStore({ [planned.id]: forgedEvents }),
      ).getMission(planned.id),
    /requires durable transport reservation tracking/,
  );
});

test("04c6ba7 Mission history normalizes legacy ownership aliases and Sol Reviewer metadata", async () => {
  const sourceStore = createMemoryEventStore();
  const source = createHarness(createImmediateRouter(), sourceStore);
  const created = source.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a pre-Ticket-05 review Mission",
  });
  source.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary: "Legacy review Context" } },
    actor: "mission-owner",
    reason: "Capture legacy Context",
  });
  source.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { summary: "Legacy single reviewer plan" } },
    actor: "mission-owner",
    reason: "Accept legacy reviewer plan",
  });
  const reviewerAssignment = task("legacy-reviewer", {
    workKind: "review",
    risk: "high",
    ownershipBoundary: {
      readPaths: ["src/review"],
      writePaths: [],
    },
  });
  delete reviewerAssignment.dependsOn;
  await source.dispatchAssignment(created.id, {
    assignment: reviewerAssignment,
    actor: "mission-owner",
    reason: "Route the legacy reviewer",
  });

  const legacyEvents = structuredClone(sourceStore.load(created.id));
  for (const event of legacyEvents) delete event.schemaVersion;
  const routed = legacyEvents.find((event) => event.type === "ASSIGNMENT_ROUTED");
  routed.data.assignment.ownershipBoundary.readPaths = [
    ".\\src\\.\\review\\",
  ];
  delete routed.data.agent.independent;
  const replay = createHarness(
    createImmediateRouter(),
    createMemoryEventStore({ [created.id]: legacyEvents }),
  );

  const mission = replay.getMission(created.id);
  assert.equal(mission.status, "IN_REVIEW");
  assert.deepEqual(mission.assignment.ownershipBoundary.readPaths, [
    "src/review",
  ]);
  assert.equal(mission.agent.independent, true);
});

test("Task Graph planning rejects writable ownership outside Mission authority", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a bounded Mission",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary: "Bounded Context" } },
    actor: "mission-owner",
    reason: "Capture bounded Context",
  });

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "ACCEPT_PLAN",
        payload: {
          plan: {
            taskGraph: {
              capacity: 4,
              coordinationRequired: true,
              assignments: [
                task("escape-authority", {
                  workKind: "implementation",
                  risk: "medium",
                  effectivePermission: "workspace-write",
                  ownershipBoundary: {
                    readPaths: ["outside"],
                    writePaths: ["outside"],
                  },
                }),
                task("review-escape-authority", {
                  dependsOn: ["escape-authority"],
                  workKind: "review",
                  risk: "high",
                }),
              ],
            },
          },
        },
        actor: "mission-owner",
        reason: "Attempt to accept out-of-authority ownership",
      }),
    /writable ownership exceeds Mission mutation authority/,
  );
});

test("Task Graph planning requires a terminal independent review that covers every candidate Assignment", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a Mission with incomplete review coverage",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary: "Review coverage Context" } },
    actor: "mission-owner",
    reason: "Capture review coverage Context",
  });

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "ACCEPT_PLAN",
        payload: {
          plan: {
            taskGraph: {
              capacity: 4,
              coordinationRequired: true,
              assignments: [
                task("candidate-without-review"),
                task("unrelated-review", {
                  workKind: "review",
                  risk: "high",
                }),
              ],
            },
          },
        },
        actor: "mission-owner",
        reason: "Attempt to accept an unrelated reviewer",
      }),
    /review Assignment must transitively depend on every candidate Assignment/,
  );
  assert.equal(orchestrator.getMission(created.id).status, "CONTEXT_READY");
});

test("Task Graph review gate requires the current independent Sol Reviewer Evidence", async () => {
  const orchestrator = createHarness();
  const planned = createPlannedMission(orchestrator, "review-gate", [
    task("build-review-candidate"),
    task("review-current-candidate", {
      dependsOn: ["build-review-candidate"],
      workKind: "review",
      risk: "high",
    }),
  ]);
  await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Complete the candidate",
  });
  const reviewed = await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Complete independent review",
  });
  const reviewer = reviewed.execution.nodes.find(
    (node) => node.assignment.id === "review-current-candidate",
  );
  const candidate = reviewed.execution.nodes.find(
    (node) => node.assignment.id === "build-review-candidate",
  );
  assert.deepEqual(
    reviewed.artifactEvidenceRefs,
    candidate.evidenceRefs,
    "the Mission must retain the completed candidate Evidence",
  );
  assert.deepEqual(
    reviewed.executionReviewEvidenceRefs,
    reviewer.evidenceRefs,
    "the UI review action must receive the current reviewer Evidence",
  );

  assert.throws(
    () =>
      orchestrator.execute(planned.id, {
        type: "PASS_REVIEW",
        payload: {
          review: {
            summary: "Attempt to bypass the independent review result",
            details: { outcome: "passed" },
          },
        },
        actor: "mission-owner",
        reason: "Attempt to pass with forged Evidence",
        evidenceRefs: ["evidence://forged-review"],
      }),
    /passing structured reviewer outcome/,
  );

  const passed = orchestrator.execute(planned.id, {
    type: "PASS_REVIEW",
    payload: {
      review: {
        summary: "Current independent review found no material issue",
        reviewerAssignmentId: reviewer.assignment.id,
        ...reviewer.reviewOutcome,
      },
    },
    actor: "agent:sol_reviewer",
    reason: "Pass with the current independent review result",
    evidenceRefs: reviewer.evidenceRefs,
  });
  assert.equal(passed.status, "VALIDATING");
});

test("review gate cannot pass a structured reviewer outcome that requests changes", async () => {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T11:00:00.000Z",
        };
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T11:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [
            {
              name: assignmentId,
              uri: `artifact://${assignmentId}`,
              ...(request.roleId === "sol_reviewer"
                ? {
                    reviewOutcome: {
                      outcome: "CHANGES_REQUESTED",
                      candidateArtifactRefs: ["artifact://candidate"],
                      findings: [
                        {
                          triggeringScenario: "Candidate replay loses ownership",
                          ownerAssignmentId: "candidate",
                          summary: "Preserve the candidate owner on replay",
                        },
                      ],
                    },
                  }
                : {}),
            },
          ],
          evidence: [
            {
              ref: `evidence://${assignmentId}`,
              kind: request.roleId === "sol_reviewer" ? "review" : "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const planned = createPlannedMission(orchestrator, "review-outcome", [
    task("candidate"),
    task("review-candidate", {
      dependsOn: ["candidate"],
      workKind: "review",
      risk: "high",
    }),
  ]);

  await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Produce the candidate",
  });
  const reviewed = await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Record a rejecting independent review",
  });
  const reviewer = reviewed.execution.nodes.find(
    (node) => node.assignment.id === "review-candidate",
  );

  assert.throws(
    () =>
      orchestrator.execute(planned.id, {
        type: "PASS_REVIEW",
        payload: {
          review: {
            summary: "Attempt to override the reviewer",
            details: { outcome: "passed" },
          },
        },
        actor: "agent:sol_reviewer",
        reason: "Attempt to pass rejected work",
        evidenceRefs: reviewer.evidenceRefs,
      }),
    /passing structured reviewer outcome/,
  );
});

test("a terminal execution error frees capacity and requires an explicit retry before redispatch", async () => {
  const attempts = new Map();
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        const attempt = (attempts.get(assignmentId) ?? 0) + 1;
        attempts.set(assignmentId, attempt);
        yield {
          kind: "started",
          runId: `run:${assignmentId}:${attempt}`,
          occurredAt: "2026-08-08T11:00:00.000Z",
        };
        if (assignmentId === "unstable-candidate" && attempt === 1) {
          throw new Error("transport failed after start");
        }
        yield {
          kind: "completed",
          runId: `run:${assignmentId}:${attempt}`,
          occurredAt: "2026-08-08T11:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [
            {
              name: assignmentId,
              uri: `artifact://${assignmentId}/${attempt}`,
              ...(request.roleId === "sol_reviewer"
                ? {
                    reviewOutcome: {
                      outcome: "PASSED",
                      candidateArtifactRefs: [
                        "artifact://unstable-candidate/2",
                      ],
                      findings: [],
                    },
                  }
                : {}),
            },
          ],
          evidence: [
            {
              ref: `evidence://${assignmentId}/${attempt}`,
              kind: request.roleId === "sol_reviewer" ? "review" : "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const planned = createPlannedMission(orchestrator, "retry-error", [
    task("unstable-candidate"),
    task("review-retried-candidate", {
      dependsOn: ["unstable-candidate"],
      workKind: "review",
      risk: "high",
    }),
  ]);

  await assert.rejects(
    orchestrator.dispatchExecutionWave(planned.id, {
      actor: "mission-owner",
      reason: "Dispatch the failing attempt",
    }),
    /execution-wave Assignment.*failed/,
  );
  const failed = orchestrator.getMission(planned.id);
  assert.deepEqual(
    {
      status: failed.execution.nodes[0].status,
      activeAssignmentIds: failed.execution.activeAssignmentIds,
      availableWorkerSlots: failed.execution.availableWorkerSlots,
      allowedActions: failed.allowedActions,
    },
    {
      status: "ERROR",
      activeAssignmentIds: [],
      availableWorkerSlots: 3,
      allowedActions: [
        "retry_execution_assignment",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );

  const retryReady = orchestrator.execute(planned.id, {
    type: "RETRY_EXECUTION_ASSIGNMENT",
    payload: {
      retry: {
        assignmentId: "unstable-candidate",
        summary: "Retry after the transient transport failure",
      },
    },
    actor: "mission-owner",
    reason: "Authorize one explicit retry",
  });
  assert.deepEqual(retryReady.execution.frontier, ["unstable-candidate"]);
  await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Dispatch the explicit retry",
  });
  const reviewed = await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Review the recovered candidate",
  });
  assert.equal(reviewed.status, "IN_REVIEW");
  assert.equal(
    reviewed.execution.nodes[0].artifacts[0].uri,
    "artifact://unstable-candidate/2",
  );
});

test("event-store subscriptions render started execution observations before the wave promise settles", async () => {
  let releaseCandidate;
  const candidateGate = new Promise((resolve) => {
    releaseCandidate = resolve;
  });
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  const eventStore = createMemoryEventStore();
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T11:00:00.000Z",
        };
        signalStarted();
        await candidateGate;
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T11:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [{ name: assignmentId, uri: `artifact://${assignmentId}` }],
          evidence: [
            {
              ref: `evidence://${assignmentId}`,
              kind: "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter, eventStore);
  const planned = createPlannedMission(orchestrator, "live-render", [
    task("observable-candidate"),
    task("review-observable-candidate", {
      dependsOn: ["observable-candidate"],
      workKind: "review",
      risk: "high",
    }),
  ]);
  const renderedSnapshots = [];
  const unsubscribe = eventStore.subscribe(() => {
    const flow = deriveMissionFlowModel(orchestrator.getMission(planned.id));
    renderedSnapshots.push(renderTaskExecutionContent(flow.execution));
  });
  let waveSettled = false;
  const dispatch = orchestrator
    .dispatchExecutionWave(planned.id, {
      actor: "mission-owner",
      reason: "Dispatch the observable candidate",
    })
    .finally(() => {
      waveSettled = true;
    });

  await started;
  assert.equal(waveSettled, false);
  assert.ok(
    renderedSnapshots.some(
      (markup) =>
        markup.includes("observable-candidate") &&
        markup.includes("state-working"),
    ),
    renderedSnapshots.join("\n--- snapshot ---\n"),
  );
  releaseCandidate();
  await dispatch;
  unsubscribe();
});

test("the four-slot pool and reserved Orchestrator slot are global across Missions", async () => {
  let releaseFirstWave;
  const firstWaveGate = new Promise((resolve) => {
    releaseFirstWave = resolve;
  });
  let holdRuns = true;
  let activeRuns = 0;
  let maximumActiveRuns = 0;
  const requests = [];
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const id = request.assignment.id;
        requests.push(id);
        activeRuns += 1;
        maximumActiveRuns = Math.max(maximumActiveRuns, activeRuns);
        try {
          yield {
            kind: "started",
            runId: `run:${id}`,
            occurredAt: "2026-08-08T12:00:00.000Z",
          };
          if (holdRuns) {
            await firstWaveGate;
          }
          yield {
            kind: "completed",
            runId: `run:${id}`,
            occurredAt: "2026-08-08T12:01:00.000Z",
            summary: `Completed ${id}`,
            artifacts: [{ name: id, uri: `artifact://${id}` }],
            evidence: [
              {
                ref: `evidence://${id}`,
                kind: "test",
                summary: `Observed ${id}`,
              },
            ],
          };
        } finally {
          activeRuns -= 1;
        }
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const first = createPlannedMission(
    orchestrator,
    "first",
    [task("first-a"), task("first-b"), task("first-c")],
  );
  const second = createPlannedMission(
    orchestrator,
    "second",
    [task("second-a"), task("second-b"), task("second-c")],
  );

  const firstDispatch = orchestrator.dispatchExecutionWave(first.id, {
    actor: "mission-owner",
    reason: "Fill the three global worker slots",
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(activeRuns, 3);

  const secondOutcome = orchestrator
    .dispatchExecutionWave(second.id, {
      actor: "mission-owner",
      reason: "Attempt to exceed the global worker pool",
    })
    .then(
      () => ({ completed: true, error: null }),
      (error) => ({ completed: false, error }),
    );
  await new Promise((resolve) => setImmediate(resolve));
  const requestsBeforeRelease = [...requests];

  holdRuns = false;
  releaseFirstWave();
  await firstDispatch;
  const blockedDispatch = await secondOutcome;
  assert.equal(blockedDispatch.completed, false);
  assert.match(blockedDispatch.error.message, /No global worker slot is available/);
  assert.deepEqual(requestsBeforeRelease, [
    "first-a",
    "first-b",
    "first-c",
  ]);
  await orchestrator.dispatchExecutionWave(second.id, {
    actor: "mission-owner",
    reason: "Dispatch after the global worker slots are free",
  });

  assert.equal(maximumActiveRuns, 3);
  assert.deepEqual(requests, [
    "first-a",
    "first-b",
    "first-c",
    "second-a",
    "second-b",
    "second-c",
  ]);
});

test("legacy Assignment dispatch uses the same global ownership admission control as execution waves", async () => {
  let releaseGraphWriter;
  const graphWriterGate = new Promise((resolve) => {
    releaseGraphWriter = resolve;
  });
  let signalGraphWriterStarted;
  const graphWriterStarted = new Promise((resolve) => {
    signalGraphWriterStarted = resolve;
  });
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T12:00:00.000Z",
        };
        if (assignmentId === "active-graph-writer") {
          signalGraphWriterStarted();
          await graphWriterGate;
        }
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T12:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [{ name: assignmentId, uri: `artifact://${assignmentId}` }],
          evidence: [
            {
              ref: `evidence://${assignmentId}`,
              kind: "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const writableOwnership = {
    readPaths: ["src/shared"],
    writePaths: ["src/shared"],
  };
  const graphMission = createPlannedMission(orchestrator, "graph-writer", [
    task("active-graph-writer", {
      workKind: "implementation",
      risk: "medium",
      effectivePermission: "workspace-write",
      ownershipBoundary: writableOwnership,
    }),
    task("review-graph-writer", {
      dependsOn: ["active-graph-writer"],
      workKind: "review",
      risk: "high",
    }),
  ]);
  const legacyCreated = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a legacy Assignment Mission",
  });
  orchestrator.execute(legacyCreated.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary: "Legacy Assignment Context" } },
    actor: "mission-owner",
    reason: "Capture legacy Context",
  });
  orchestrator.execute(legacyCreated.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { summary: "One bounded legacy writer" } },
    actor: "mission-owner",
    reason: "Accept the legacy plan",
  });
  const legacyWriter = task("legacy-overlap", {
    workKind: "implementation",
    risk: "medium",
    effectivePermission: "workspace-write",
    ownershipBoundary: writableOwnership,
  });
  delete legacyWriter.dependsOn;

  const graphDispatch = orchestrator.dispatchExecutionWave(graphMission.id, {
    actor: "mission-owner",
    reason: "Start the graph writer",
  });
  await graphWriterStarted;
  const legacyOutcome = await orchestrator
    .dispatchAssignment(legacyCreated.id, {
      assignment: legacyWriter,
      actor: "mission-owner",
      reason: "Attempt an overlapping legacy dispatch",
    })
    .then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
  releaseGraphWriter();
  await graphDispatch;
  assert.match(
    legacyOutcome.error?.message ?? "",
    /overlaps active writable ownership/,
  );
});

test("legacy correction dispatch uses the same global ownership admission control as execution waves", async () => {
  let releaseGraphWriter;
  const graphWriterGate = new Promise((resolve) => {
    releaseGraphWriter = resolve;
  });
  let signalGraphWriterStarted;
  const graphWriterStarted = new Promise((resolve) => {
    signalGraphWriterStarted = resolve;
  });
  const requestCounts = new Map();
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        const requestCount = (requestCounts.get(assignmentId) ?? 0) + 1;
        requestCounts.set(assignmentId, requestCount);
        yield {
          kind: "started",
          runId: `run:${assignmentId}:${requestCount}`,
          occurredAt: "2026-08-08T12:00:00.000Z",
        };
        if (assignmentId === "active-correction-conflict") {
          signalGraphWriterStarted();
          await graphWriterGate;
        }
        yield {
          kind: "completed",
          runId: `run:${assignmentId}:${requestCount}`,
          occurredAt: "2026-08-08T12:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [
            {
              name: assignmentId,
              uri: `artifact://${assignmentId}/${requestCount}`,
            },
          ],
          evidence: [
            {
              ref: `evidence://${assignmentId}/${requestCount}`,
              kind: "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const writableOwnership = {
    readPaths: ["src/shared.js"],
    writePaths: ["src/shared.js"],
  };
  const legacyCreated = orchestrator.createMission({
    brief,
    actor: "mission-owner",
    reason: "Create a legacy correction Mission",
  });
  orchestrator.execute(legacyCreated.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: { summary: "Legacy correction Context" } },
    actor: "mission-owner",
    reason: "Capture legacy correction Context",
  });
  orchestrator.execute(legacyCreated.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { summary: "One bounded legacy correction writer" } },
    actor: "mission-owner",
    reason: "Accept the legacy correction plan",
  });
  const legacyWriter = task("legacy-correction-writer", {
    workKind: "implementation",
    risk: "medium",
    effectivePermission: "workspace-write",
    ownershipBoundary: writableOwnership,
  });
  delete legacyWriter.dependsOn;
  await orchestrator.dispatchAssignment(legacyCreated.id, {
    assignment: legacyWriter,
    actor: "mission-owner",
    reason: "Dispatch the initial legacy writer",
  });
  orchestrator.execute(legacyCreated.id, {
    type: "REJECT_REVIEW",
    payload: { review: { summary: "Regenerate the legacy candidate" } },
    actor: "mission-owner",
    reason: "Request a legacy correction",
    evidenceRefs: ["evidence://legacy-review-rejection"],
  });

  const graphMission = createPlannedMission(
    orchestrator,
    "correction-conflict",
    [
      task("active-correction-conflict", {
        workKind: "implementation",
        risk: "medium",
        effectivePermission: "workspace-write",
        ownershipBoundary: writableOwnership,
      }),
      task("review-correction-conflict", {
        dependsOn: ["active-correction-conflict"],
        workKind: "review",
        risk: "high",
      }),
    ],
  );
  const graphDispatch = orchestrator.dispatchExecutionWave(graphMission.id, {
    actor: "mission-owner",
    reason: "Start the conflicting graph writer",
  });
  await graphWriterStarted;

  const correctionOutcome = await orchestrator
    .dispatchCorrection(legacyCreated.id, {
      actor: "mission-owner",
      reason: "Attempt an overlapping legacy correction",
    })
    .then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
  releaseGraphWriter();
  await graphDispatch;

  assert.match(
    correctionOutcome.error?.message ?? "",
    /overlaps active writable ownership/,
  );
  assert.equal(requestCounts.get("legacy-correction-writer"), 1);
});

test("cancelling an active execution wave retains capacity until every transport settles", async () => {
  let releaseCancelledWave;
  const cancelledWaveGate = new Promise((resolve) => {
    releaseCancelledWave = resolve;
  });
  let signalThreeStarted;
  const threeStarted = new Promise((resolve) => {
    signalThreeStarted = resolve;
  });
  let heldStartedCount = 0;
  const requests = [];
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        requests.push(assignmentId);
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T12:00:00.000Z",
        };
        if (assignmentId.startsWith("held-")) {
          heldStartedCount += 1;
          if (heldStartedCount === 3) signalThreeStarted();
          await cancelledWaveGate;
        }
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T12:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [{ name: assignmentId, uri: `artifact://${assignmentId}` }],
          evidence: [
            {
              ref: `evidence://${assignmentId}`,
              kind: "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const first = createPlannedMission(orchestrator, "cancel-active-wave", [
    task("held-a"),
    task("held-b"),
    task("held-c"),
    task("review-held", {
      dependsOn: ["held-a", "held-b", "held-c"],
      workKind: "review",
      risk: "high",
    }),
  ]);
  const second = createPlannedMission(orchestrator, "after-cancellation", [
    task("available-after-cancel"),
    task("review-after-cancel", {
      dependsOn: ["available-after-cancel"],
      workKind: "review",
      risk: "high",
    }),
  ]);

  const cancelledDispatch = orchestrator.dispatchExecutionWave(first.id, {
    actor: "mission-owner",
    reason: "Fill all worker slots before cancellation",
  });
  await threeStarted;
  const cancelled = orchestrator.execute(first.id, {
    type: "CANCEL_MISSION",
    payload: { cancellation: { summary: "Stop the active execution wave" } },
    actor: "mission-owner",
    reason: "Mission owner cancelled active work",
  });
  assert.deepEqual(
    {
      status: cancelled.status,
      nodeStatuses: cancelled.execution.nodes
        .slice(0, 3)
        .map((node) => node.status),
      activeAssignmentIds: cancelled.execution.activeAssignmentIds,
    },
    {
      status: "CANCELLED",
      nodeStatuses: ["CANCELLED", "CANCELLED", "CANCELLED"],
      activeAssignmentIds: [],
    },
  );

  const beforeTransportSettles = await orchestrator
    .dispatchExecutionWave(second.id, {
      actor: "mission-owner",
      reason: "Attempt to reuse capacity before cancelled transports settle",
    })
    .then(
      () => ({ error: null }),
      (error) => ({ error }),
    );
  const dispatchedBeforeSettlement = requests.includes(
    "available-after-cancel",
  );
  releaseCancelledWave();
  assert.equal((await cancelledDispatch).status, "CANCELLED");
  assert.match(
    beforeTransportSettles.error?.message ?? "",
    /No global worker slot is available/,
  );
  assert.equal(dispatchedBeforeSettlement, false);
  await orchestrator.dispatchExecutionWave(second.id, {
    actor: "mission-owner",
    reason: "Use capacity after cancelled transports settled",
  });
  assert.ok(requests.includes("available-after-cancel"));
});

test("explicit recovery releases durable orphan reservations after a Mission restart", async () => {
  let releaseTransport;
  const transportGate = new Promise((resolve) => {
    releaseTransport = resolve;
  });
  let signalAllStarted;
  let startedCount = 0;
  const allStarted = new Promise((resolve) => {
    signalAllStarted = resolve;
  });
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        startedCount += 1;
        yield {
          kind: "started",
          runId: `run:${request.assignment.id}`,
          occurredAt: "2026-08-08T13:00:00.000Z",
        };
        if (startedCount === 3) signalAllStarted();
        await transportGate;
        yield {
          kind: "completed",
          runId: `run:${request.assignment.id}`,
          occurredAt: "2026-08-08T13:01:00.000Z",
          summary: `Completed ${request.assignment.id}`,
          artifacts: [
            {
              name: request.assignment.id,
              uri: `artifact://${request.assignment.id}`,
            },
          ],
          evidence: [
            {
              ref: `evidence://${request.assignment.id}`,
              kind: "test",
              summary: `Observed ${request.assignment.id}`,
            },
          ],
        };
      },
    },
  });
  const eventStore = createMemoryEventStore();
  const worker = createHarness(agentRouter, eventStore);
  const planned = createPlannedMission(worker, "orphan-recovery", [
    task("orphan-a"),
    task("orphan-b"),
    task("orphan-c"),
  ]);
  const dispatch = worker.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Start the wave that may outlive this tab",
  });
  await allStarted;
  const blocked = worker.execute(planned.id, {
    type: "BLOCK_MISSION",
    payload: {
      block: {
        blocker: "The worker tab was closed before transport settlement",
        attemptedAlternatives: ["Waited for the transport to settle"],
        requiredAuthorityOrInput: "Mission owner confirmation of transport state",
      },
    },
    actor: "mission-owner",
    reason: "Block the orphaned execution wave safely",
  });
  let recoveryEventNumber = 0;
  const restarted = createMissionOrchestrator({
    eventStore,
    agentRouter: createImmediateRouter(),
    createId: (kind) =>
      kind === "mission"
        ? "unused-recovery-mission"
        : `recovery-event-${++recoveryEventNumber}`,
    clock: () => "2026-08-08T13:02:00.000Z",
  });
  const dispatchEvent = blocked.events.find(
    (event) => event.type === "EXECUTION_WAVE_DISPATCHED",
  );
  assert.deepEqual(
    restarted.getMission(planned.id).allowedActions,
    ["recover_execution_transport", "resume_mission", "cancel_mission"],
  );

  let recovered = restarted.getMission(planned.id);
  for (const routing of dispatchEvent.data.routings) {
    const assignmentId = routing.assignment.id;
    recovered = restarted.execute(planned.id, {
      type: "RECOVER_EXECUTION_TRANSPORT",
      payload: {
        recovery: {
          assignmentId,
          waveId: dispatchEvent.data.wave.id,
          attempt: dispatchEvent.data.transportReservationAttempts[assignmentId],
          summary: `Confirmed the orphaned ${assignmentId} transport cannot continue`,
        },
      },
      actor: "mission-owner",
      reason: `Release the orphaned ${assignmentId} reservation after restart`,
    });
  }
  assert.deepEqual(recovered.allowedActions, ["resume_mission", "cancel_mission"]);

  releaseTransport();
  const settledAfterRecovery = await dispatch;
  assert.equal(settledAfterRecovery.status, "BLOCKED");
  assert.equal(
    settledAfterRecovery.events.filter(
      (event) => event.type === "EXECUTION_TRANSPORT_SETTLED",
    ).length,
    0,
  );
});

test("cross-tab cancellation identifies the changed Mission and aborts its transport", async () => {
  const records = new Map();
  const storage = {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => records.set(key, value),
  };
  const storageKey = "cross-tab-execution-test";
  const workerEvents = createStorageEventTarget();
  const ownerEvents = createStorageEventTarget();
  const workerStore = createLocalStorageEventStore({
    storage,
    key: storageKey,
    eventTarget: workerEvents,
  });
  const ownerStore = createLocalStorageEventStore({
    storage,
    key: storageKey,
    eventTarget: ownerEvents,
  });
  let releaseTransport;
  const manualRelease = new Promise((resolve) => {
    releaseTransport = resolve;
  });
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  let observedSignal;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        observedSignal = request.signal;
        yield {
          kind: "started",
          runId: `run:${request.assignment.id}`,
          occurredAt: "2026-08-08T12:00:00.000Z",
        };
        signalStarted();
        const aborted = observedSignal
          ? new Promise((resolve) =>
              observedSignal.addEventListener("abort", resolve, { once: true }),
            )
          : new Promise(() => {});
        await Promise.race([manualRelease, aborted]);
      },
    },
  });
  const worker = createHarness(agentRouter, workerStore);
  let ownerEvent = 0;
  const owner = createMissionOrchestrator({
    eventStore: ownerStore,
    agentRouter,
    createId: (kind) => `owner-${kind}-${++ownerEvent}`,
    clock: () => "2026-08-08T12:00:00.000Z",
  });
  const planned = createPlannedMission(worker, "cross-tab-cancel", [
    task("cross-tab-worker"),
    task("review-cross-tab-worker", {
      dependsOn: ["cross-tab-worker"],
      workKind: "review",
      risk: "high",
    }),
  ]);
  const dispatch = worker.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Dispatch work owned by another tab",
  });
  await started;
  const oldValue = records.get(storageKey);
  owner.execute(planned.id, {
    type: "CANCEL_MISSION",
    payload: { cancellation: { summary: "Cancel from the owner tab" } },
    actor: "mission-owner",
    reason: "Cancel cross-tab work",
  });
  const newValue = records.get(storageKey);
  workerEvents.dispatchStorage({
    key: storageKey,
    storageArea: storage,
    oldValue,
    newValue,
  });
  await new Promise((resolve) => setImmediate(resolve));
  const wasAborted = observedSignal?.aborted;
  releaseTransport();
  await dispatch;

  assert.equal(wasAborted, true);
});

test("blocking an active execution wave aborts its transport and resumes the interrupted Assignment at the frontier", async () => {
  let releaseTransport;
  const manualRelease = new Promise((resolve) => {
    releaseTransport = resolve;
  });
  let signalStarted;
  const started = new Promise((resolve) => {
    signalStarted = resolve;
  });
  let observedSignal;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        observedSignal = request.signal;
        yield {
          kind: "started",
          runId: `run:${request.assignment.id}`,
          occurredAt: "2026-08-08T12:00:00.000Z",
        };
        signalStarted();
        const aborted = observedSignal
          ? new Promise((resolve) =>
              observedSignal.addEventListener("abort", resolve, { once: true }),
            )
          : new Promise(() => {});
        await Promise.race([manualRelease, aborted]);
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const planned = createPlannedMission(orchestrator, "block-active-wave", [
    task("interruptible-candidate"),
    task("review-interruptible-candidate", {
      dependsOn: ["interruptible-candidate"],
      workKind: "review",
      risk: "high",
    }),
  ]);

  const dispatch = orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Dispatch interruptible work",
  });
  await started;
  const blocked = orchestrator.execute(planned.id, {
    type: "BLOCK_MISSION",
    payload: {
      block: {
        blocker: "Owner paused the active wave",
        attemptedAlternatives: ["Wait for the current transport"],
        requiredAuthorityOrInput: "Mission owner resume decision",
      },
    },
    actor: "mission-owner",
    reason: "Pause active execution safely",
  });

  releaseTransport();
  const dispatchOutcome = await dispatch.then(
    () => ({ error: null }),
    (error) => ({ error }),
  );
  assert.equal(observedSignal?.aborted, true);
  assert.equal(dispatchOutcome.error, null);
  assert.equal(blocked.execution.nodes[0].status, "INTERRUPTED");
  assert.deepEqual(blocked.execution.activeAssignmentIds, []);

  const resumed = orchestrator.execute(planned.id, {
    type: "RESUME_MISSION",
    payload: {
      resumption: { summary: "Resume from the prior safe execution state" },
    },
    actor: "mission-owner",
    reason: "Resume after confirming the transport stopped",
  });
  assert.equal(resumed.status, "RUNNING");
  assert.equal(resumed.execution.nodes[0].status, "PENDING");
  assert.deepEqual(resumed.execution.frontier, ["interruptible-candidate"]);
});

test("Decision Room replay rejects Evidence invalidated by a material Context revision", async () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(createImmediateRouter(), eventStore);
  const firstPlan = createPlannedMission(orchestrator, "stale-decision-input", [
    task("produce-stale-decision-input"),
  ]);
  const completed = await orchestrator.dispatchExecutionWave(firstPlan.id, {
    actor: "mission-owner",
    reason: "Produce Evidence that a later Context revision invalidates",
  });
  const staleEvidence = completed.artifactEvidenceRefs[0];

  const revised = orchestrator.execute(firstPlan.id, {
    type: "REVISE_CONTEXT",
    payload: { context: { summary: "Material Context version two" } },
    actor: "mission-owner",
    reason: "Replace the material Context",
  });
  assert.ok(revised.invalidatedEvidenceRefs.includes(staleEvidence));

  const planned = orchestrator.execute(firstPlan.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        taskGraph: {
          capacity: 4,
          coordinationRequired: true,
          assignments: [
            task("architect-current-context", {
              workKind: "architecture",
              risk: "high",
              requiresDecision: true,
            }),
            task("review-current-context", {
              dependsOn: ["architect-current-context"],
              workKind: "review",
              risk: "high",
            }),
          ],
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept a Task Graph for the revised Context",
  });
  const assignmentId = planned.execution.nodes[0].assignment.id;
  const decisionRoom = {
    id: "decision-room-current-context",
    assignmentId,
    assignmentAttempt: 1,
    question: "Which current-context seam should own the change?",
    participantRoles: [
      "orchestrator",
      "sol_architect",
      "sol_reviewer",
    ],
    participantInputs: [
      {
        roleId: "orchestrator",
        contribution: "Use only current Context Evidence",
        evidenceRefs: [staleEvidence],
      },
      {
        roleId: "sol_architect",
        contribution: "Choose the smallest safe seam",
        evidenceRefs: [staleEvidence],
      },
      {
        roleId: "sol_reviewer",
        contribution: "Reject stale input Evidence",
        evidenceRefs: [staleEvidence],
      },
    ],
    expectedOutput: "A reusable current-context decision Artifact",
    alternatives: [
      {
        id: "deep-module",
        label: "Dedicated deep module",
        tradeoffs: ["Adds a seam", "Localizes replay policy"],
      },
      {
        id: "inline",
        label: "Inline orchestration",
        tradeoffs: ["Fewer files", "Broader lifecycle surface"],
      },
    ],
    recommendation: {
      alternativeId: "deep-module",
      rationale: "Keep replay policy local",
    },
    validationPlan: ["Replay stale Decision Room Evidence"],
  };

  assert.throws(
    () =>
      orchestrator.execute(firstPlan.id, {
        type: "OPEN_DECISION_ROOM",
        payload: {
          decisionRoom,
        },
        actor: "mission-owner",
        reason: "Attempt to reuse stale Decision Room input",
        evidenceRefs: [staleEvidence],
      }),
    /current Evidence/,
  );

  eventStore.append(
    firstPlan.id,
    [
      {
        id: "event-forged-stale-decision-room",
        missionId: firstPlan.id,
        sequence: planned.events.length + 1,
        type: "DECISION_ROOM_OPENED",
        actor: "mission-owner",
        occurredAt: "2026-08-08T11:02:00.000Z",
        reason: "Forge stale Decision Room Evidence into stored history",
        contextPackVersion: planned.contextPackVersion,
        evidenceRefs: [staleEvidence],
        data: { decisionRoom },
      },
    ],
    { expectedSequence: planned.events.length },
  );

  assert.throws(
    () => orchestrator.getMission(firstPlan.id),
    /DECISION_ROOM_OPENED requires current Evidence/,
  );
});

test("resolved Decision Room Artifact is supplied to its affected Assignment", async () => {
  const requests = [];
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        requests.push(request);
        const assignmentId = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T12:00:00.000Z",
        };
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T12:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [{ name: assignmentId, uri: `artifact://${assignmentId}` }],
          evidence: [
            {
              ref: `evidence://${assignmentId}`,
              kind: "test",
              summary: `Observed ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(agentRouter);
  const planned = createPlannedMission(orchestrator, "decision-context", [
    task("prepare-decision-context"),
    task("architect-with-decision", {
      dependsOn: ["prepare-decision-context"],
      requiresDecision: true,
      workKind: "architecture",
      risk: "high",
    }),
    task("review-decision-context", {
      dependsOn: ["architect-with-decision"],
      workKind: "review",
      risk: "high",
    }),
  ]);
  const prepared = await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Produce Decision Room input Evidence",
  });
  const evidenceRef = prepared.execution.nodes.find(
    (node) => node.assignment.id === "prepare-decision-context",
  ).evidenceRefs[0];
  const room = {
    id: "decision-room:architect-with-decision:1",
    assignmentId: "architect-with-decision",
    assignmentAttempt: 1,
    question: "Which boundary should own transport admission?",
    participantRoles: ["orchestrator", "sol_architect", "sol_reviewer"],
    participantInputs: [
      {
        roleId: "orchestrator",
        contribution: "Keep admission globally auditable",
        evidenceRefs: [evidenceRef],
      },
      {
        roleId: "sol_architect",
        contribution: "Use one orchestration boundary",
        evidenceRefs: [evidenceRef],
      },
      {
        roleId: "sol_reviewer",
        contribution: "Verify interruption before releasing ownership",
        evidenceRefs: [evidenceRef],
      },
    ],
    expectedOutput: "A reusable admission-boundary decision Artifact",
    alternatives: [
      {
        id: "central-boundary",
        label: "Central boundary",
        tradeoffs: ["One admission point", "Explicit settlement event"],
      },
      {
        id: "per-agent",
        label: "Per-agent admission",
        tradeoffs: ["Local autonomy", "No global capacity view"],
      },
    ],
    recommendation: {
      alternativeId: "central-boundary",
      rationale: "Preserve one auditable capacity invariant",
    },
    validationPlan: ["Hold capacity until transport settlement"],
  };
  orchestrator.execute(planned.id, {
    type: "OPEN_DECISION_ROOM",
    payload: { decisionRoom: room },
    actor: "mission-owner",
    reason: "Open the admission Decision Room",
    evidenceRefs: [evidenceRef],
  });
  orchestrator.execute(planned.id, {
    type: "RESOLVE_DECISION_ROOM",
    payload: {
      decision: {
        roomId: room.id,
        assignmentAttempt: 1,
        selectedAlternativeId: "central-boundary",
        rationale: "Use the central boundary for this Assignment",
        artifact: {
          id: "decision-artifact:central-boundary",
          uri: "decision://central-boundary",
          summary: "Use the central admission boundary",
        },
      },
    },
    actor: "mission-owner",
    reason: "Resolve the admission Decision Room",
  });
  await orchestrator.dispatchExecutionWave(planned.id, {
    actor: "mission-owner",
    reason: "Dispatch the consequential Assignment",
  });

  const architectRequest = requests.find(
    (request) => request.assignment.id === "architect-with-decision",
  );
  assert.deepEqual(
    {
      roomId: architectRequest?.decisionContext?.roomId,
      assignmentAttempt:
        architectRequest?.decisionContext?.assignmentAttempt,
      artifactUri:
        architectRequest?.decisionContext?.decisionArtifact?.uri,
      selectedAlternativeId:
        architectRequest?.decisionContext?.decisionArtifact
          ?.selectedAlternativeId,
      rationale:
        architectRequest?.decisionContext?.decisionArtifact?.rationale,
    },
    {
      roomId: room.id,
      assignmentAttempt: 1,
      artifactUri: "decision://central-boundary",
      selectedAlternativeId: "central-boundary",
      rationale: "Use the central boundary for this Assignment",
    },
  );
});
