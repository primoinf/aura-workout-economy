import assert from "node:assert/strict";
import test from "node:test";

import { routeAgentAssignment } from "../src/agent-routing-adapter.js";
import {
  applyTaskReviewFindings,
  createTaskExecution,
  interruptTaskExecution,
  nextDecisionRoomInput,
  planTaskExecutionWave,
  projectTaskExecutionEvent,
  resumeInterruptedTaskExecution,
  taskExecutionAllowedActions,
} from "../src/task-graph-execution.js";

const baseAssignment = {
  id: "task-001",
  goal: "Exercise the Task Graph execution contract",
  acceptanceCriteria: ["The projected state is deterministic"],
  contextSlice: {
    summary: "Only the Task Graph execution seam is in scope",
    sourceRefs: ["src/task-graph-execution.js"],
  },
  ownershipBoundary: {
    readPaths: ["src/task-graph-execution.js"],
    writePaths: [],
  },
  effectivePermission: "read-only",
  budget: { maxTurns: 3, maxMinutes: 10 },
  expectedEvidence: ["Deterministic contract Evidence"],
  workKind: "deterministic",
  risk: "low",
};

function task(id, overrides = {}) {
  return {
    ...structuredClone(baseAssignment),
    id,
    goal: `Complete ${id}`,
    dependsOn: [],
    ...structuredClone(overrides),
  };
}

function executionFor(assignments, overrides = {}) {
  return createTaskExecution({
    capacity: 4,
    coordinationRequired: true,
    assignments,
    ...overrides,
  });
}

function waveEvent(execution, waveId, options = {}) {
  const wave = { id: waveId, ...planTaskExecutionWave(execution) };
  return {
    type: "EXECUTION_WAVE_DISPATCHED",
    actor: "mission-owner",
    evidenceRefs: [],
    data: {
      wave,
      routings: wave.assignmentIds.map((assignmentId) => {
        const node = execution.nodes.find(
          (candidate) => candidate.assignment.id === assignmentId,
        );
        return routeAgentAssignment(node.assignment);
      }),
      ...structuredClone(options),
    },
  };
}

function runEvent(type, assignmentId, waveId, attempt, overrides = {}) {
  const runId = `run:${assignmentId}:${attempt}`;
  const completed = type === "EXECUTION_RUN_COMPLETED";
  const {
    actor = "agent:luna_worker",
    ...dataOverrides
  } = structuredClone(overrides);
  return {
    type,
    actor,
    evidenceRefs: completed ? [`evidence://${assignmentId}/${attempt}`] : [],
    data: {
      assignmentId,
      waveId,
      attempt,
      run: {
        id: runId,
        status: completed ? "COMPLETED" : "WORKING",
        startedAt: "2026-08-08T09:00:00.000Z",
        updatedAt: "2026-08-08T09:01:00.000Z",
        summary: completed ? `Completed ${assignmentId}` : null,
        evidence: completed
          ? [
              {
                ref: `evidence://${assignmentId}/${attempt}`,
                kind: "test",
                summary: `Evidence for ${assignmentId} attempt ${attempt}`,
              },
            ]
          : [],
      },
      ...(completed
        ? {
            artifacts: [
              {
                name: `${assignmentId}-${attempt}`,
                uri: `artifact://${assignmentId}/${attempt}`,
              },
            ],
          }
        : {}),
      ...dataOverrides,
    },
  };
}

function completeNode(
  execution,
  assignmentId,
  waveId,
  attempt,
  reviewFindings = null,
) {
  const sourceNode = execution.nodes.find(
    (node) => node.assignment.id === assignmentId,
  );
  const actor = `agent:${sourceNode.agent.roleId}`;
  let next = projectTaskExecutionEvent(
    execution,
    runEvent("EXECUTION_RUN_STARTED", assignmentId, waveId, attempt, {
      actor,
    }),
  );
  const completedEvent = runEvent(
    "EXECUTION_RUN_COMPLETED",
    assignmentId,
    waveId,
    attempt,
    { actor },
  );
  if (sourceNode.assignment.workKind === "review") {
    const nodesById = new Map(
      next.nodes.map((node) => [node.assignment.id, node]),
    );
    const dependencyIds = new Set();
    const collectDependencies = (id) => {
      for (const dependencyId of nodesById.get(id)?.dependsOn ?? []) {
        if (!dependencyIds.has(dependencyId)) {
          dependencyIds.add(dependencyId);
          collectDependencies(dependencyId);
        }
      }
    };
    collectDependencies(assignmentId);
    completedEvent.data.artifacts[0].reviewOutcome = {
      outcome: reviewFindings ? "CHANGES_REQUESTED" : "PASSED",
      candidateArtifactRefs: next.nodes
        .filter(
          (node) =>
            dependencyIds.has(node.assignment.id) &&
            node.assignment.workKind !== "review",
        )
        .flatMap((node) => node.artifacts.map((artifact) => artifact.uri)),
      findings: reviewFindings ?? [],
    };
  }
  next = projectTaskExecutionEvent(
    next,
    completedEvent,
  );
  return next;
}

test("Task Graph rejects non-canonical ownership aliases before planning", () => {
  assert.throws(
    () =>
      executionFor([
        task("alias-owner", {
          workKind: "implementation",
          risk: "medium",
          effectivePermission: "workspace-write",
          ownershipBoundary: {
            readPaths: ["src/shared"],
            writePaths: ["src/./shared/file.js"],
          },
        }),
      ]),
    /canonical bounded relative paths/,
  );
});

test("wave replay rejects a forged route that mutates the planned Assignment", () => {
  const execution = executionFor([task("inspect-events")]);
  const event = waveEvent(execution, "wave-1");
  event.data.routings[0] = {
    assignment: {
      ...structuredClone(event.data.routings[0].assignment),
      workKind: "implementation",
      risk: "medium",
      effectivePermission: "workspace-write",
      ownershipBoundary: {
        readPaths: ["src"],
        writePaths: ["src/shared"],
      },
    },
    agent: {
      roleId: "terra_builder",
      roleName: "Terra Builder",
      capability: "implementation",
      effectivePermission: "workspace-write",
    },
  };

  assert.throws(
    () => projectTaskExecutionEvent(execution, event),
    /canonical routing policy/,
  );
});

test("Run replay rejects an actor that does not own the routed Assignment", () => {
  let execution = executionFor([
    task("build-owned-by-terra", {
      workKind: "implementation",
      risk: "medium",
      effectivePermission: "workspace-write",
      ownershipBoundary: {
        readPaths: ["src/owned"],
        writePaths: ["src/owned"],
      },
    }),
  ]);
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-terra-owner"),
  );

  assert.throws(
    () =>
      projectTaskExecutionEvent(
        execution,
        runEvent(
          "EXECUTION_RUN_STARTED",
          "build-owned-by-terra",
          "wave-terra-owner",
          1,
        ),
      ),
    /routed agent actor/,
  );
});

test("blocked execution Runs require the full recovery contract and expose explicit retry", () => {
  let execution = executionFor([task("blocked-owner")]);
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-blocked-owner"),
  );
  execution = projectTaskExecutionEvent(
    execution,
    runEvent(
      "EXECUTION_RUN_STARTED",
      "blocked-owner",
      "wave-blocked-owner",
      1,
    ),
  );
  const incompleteBlockedEvent = runEvent(
    "EXECUTION_RUN_BLOCKED",
    "blocked-owner",
    "wave-blocked-owner",
    1,
    {
      data: undefined,
    },
  );
  incompleteBlockedEvent.data.run.status = "BLOCKED";
  assert.throws(
    () => projectTaskExecutionEvent(execution, incompleteBlockedEvent),
    /Blocked execution Run requires a working Run/,
  );

  const blockedEvent = structuredClone(incompleteBlockedEvent);
  Object.assign(blockedEvent.data.run, {
    blocker: "Missing approval input",
    attemptedAlternatives: ["Checked the current Context Pack"],
    requiredAuthorityOrInput: "Mission owner approval",
  });
  const blocked = projectTaskExecutionEvent(execution, blockedEvent);
  assert.equal(blocked.nodes[0].status, "BLOCKED");
  assert.deepEqual(taskExecutionAllowedActions(blocked), [
    "retry_execution_assignment",
  ]);
});

test("retry attempts reject delayed Run events from a historical wave", () => {
  let execution = executionFor([
    task("build-owner", {
      workKind: "implementation",
      risk: "medium",
      effectivePermission: "workspace-write",
      ownershipBoundary: {
        readPaths: ["src/owner"],
        writePaths: ["src/owner"],
      },
    }),
    task("review-owner", {
      dependsOn: ["build-owner"],
      workKind: "review",
      risk: "high",
    }),
  ]);

  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-owner-1"),
  );
  execution = completeNode(execution, "build-owner", "wave-owner-1", 1);
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-review-1"),
  );
  const findings = [
    {
      triggeringScenario: "The first owner attempt loses a terminal event",
      ownerAssignmentId: "build-owner",
      summary: "Preserve the terminal owner on replay",
    },
  ];
  execution = completeNode(
    execution,
    "review-owner",
    "wave-review-1",
    1,
    findings,
  );
  execution = applyTaskReviewFindings(execution, {
    reviewerAssignmentId: "review-owner",
    findings,
  }).execution;
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-owner-2"),
  );

  assert.equal(
    execution.nodes.find((node) => node.assignment.id === "build-owner")
      .attempt,
    2,
  );
  assert.throws(
    () =>
      projectTaskExecutionEvent(
        execution,
        runEvent(
          "EXECUTION_RUN_STARTED",
          "build-owner",
          "wave-owner-1",
          1,
        ),
      ),
    /current wave and attempt/,
  );
});

test("resuming an interrupted Assignment preserves its historical wave status", () => {
  let execution = executionFor([task("interrupt-and-resume")]);
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-interrupted"),
  );
  execution = projectTaskExecutionEvent(
    execution,
    runEvent(
      "EXECUTION_RUN_STARTED",
      "interrupt-and-resume",
      "wave-interrupted",
      1,
    ),
  );
  execution = interruptTaskExecution(execution, {
    status: "INTERRUPTED",
    occurredAt: "2026-08-08T09:02:00.000Z",
    reason: "Pause the first attempt",
  });
  assert.equal(execution.waves[0].status, "INTERRUPTED");

  execution = resumeInterruptedTaskExecution(execution);
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-resumed"),
  );
  execution = projectTaskExecutionEvent(
    execution,
    runEvent(
      "EXECUTION_RUN_STARTED",
      "interrupt-and-resume",
      "wave-resumed",
      2,
    ),
  );

  assert.deepEqual(
    execution.waves.map((wave) => wave.status),
    ["INTERRUPTED", "WORKING"],
  );
});

test("review findings can target only a transitive prerequisite of the reviewer", () => {
  let execution = executionFor([
    task("unrelated-owner"),
    task("independent-review", {
      workKind: "review",
      risk: "high",
    }),
  ]);
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-unrelated"),
  );
  execution = completeNode(execution, "unrelated-owner", "wave-unrelated", 1);
  assert.throws(
    () =>
      completeNode(
        execution,
        "independent-review",
        "wave-unrelated",
        1,
        [
          {
            triggeringScenario: "A finding attempts to claim unrelated work",
            ownerAssignmentId: "unrelated-owner",
            summary: "Do not claim work outside the review closure",
          },
        ],
      ),
    /outside the reviewed candidate closure/,
  );
});

test("Decision Room resolution is scoped to the next Assignment attempt and current prerequisite Evidence", () => {
  let execution = executionFor(
    [
      task("prepare-input"),
      task("review-input", {
        dependsOn: ["prepare-input"],
        workKind: "review",
        risk: "high",
      }),
      task("choose-seam", {
        dependsOn: ["prepare-input"],
        requiresDecision: true,
        workKind: "architecture",
        risk: "high",
      }),
    ],
    { capacity: 2 },
  );
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-prepare-1"),
  );
  execution = completeNode(execution, "prepare-input", "wave-prepare-1", 1);

  const room = {
    id: "room:choose-seam:1",
    assignmentId: "choose-seam",
    assignmentAttempt: 1,
    question: "Which execution seam should own the invariant?",
    participantRoles: ["orchestrator", "sol_architect", "sol_reviewer"],
    participantInputs: [
      {
        roleId: "orchestrator",
        contribution: "Keep the execution frontier auditable",
        evidenceRefs: ["evidence://prepare-input/1"],
      },
      {
        roleId: "sol_architect",
        contribution: "Localize the invariant in one module",
        evidenceRefs: ["evidence://prepare-input/1"],
      },
      {
        roleId: "sol_reviewer",
        contribution: "Replay stale inputs before acceptance",
        evidenceRefs: ["evidence://prepare-input/1"],
      },
    ],
    expectedOutput: "A reusable execution-seam decision Artifact",
    alternatives: [
      {
        id: "inline",
        label: "Inline Orchestrator logic",
        tradeoffs: ["Fewer files", "Broader Orchestrator"],
      },
      {
        id: "deep-module",
        label: "Deep Task Graph module",
        tradeoffs: ["One extra seam", "Local replay invariants"],
      },
    ],
    recommendation: {
      alternativeId: "deep-module",
      rationale: "Keep replay rules together",
    },
    validationPlan: ["Replay stale inputs", "Run contract tests"],
  };
  execution = projectTaskExecutionEvent(execution, {
    type: "DECISION_ROOM_OPENED",
    actor: "mission-owner",
    evidenceRefs: ["evidence://prepare-input/1"],
    data: { decisionRoom: room },
  });
  execution = projectTaskExecutionEvent(execution, {
    type: "DECISION_ROOM_RESOLVED",
    actor: "mission-owner",
    evidenceRefs: [],
    data: {
      decision: {
        roomId: room.id,
        assignmentAttempt: 1,
        selectedAlternativeId: "deep-module",
        rationale: "The deep seam is replayable",
        artifact: {
          id: "decision-artifact:choose-seam",
          uri: "decision://choose-seam",
          summary: "Use the deep seam and replay stale inputs",
        },
      },
    },
  });
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-review-input"),
  );
  const staleInputFindings = [
    {
      triggeringScenario: "Prepared input is stale",
      ownerAssignmentId: "prepare-input",
      summary: "Regenerate the prepared input",
    },
  ];
  execution = completeNode(
    execution,
    "review-input",
    "wave-review-input",
    1,
    staleInputFindings,
  );
  execution = applyTaskReviewFindings(execution, {
    reviewerAssignmentId: "review-input",
    findings: staleInputFindings,
  }).execution;
  execution = projectTaskExecutionEvent(
    execution,
    waveEvent(execution, "wave-prepare-2"),
  );
  execution = completeNode(execution, "prepare-input", "wave-prepare-2", 2);

  assert.deepEqual(execution.decisionRequiredAssignmentIds, ["choose-seam"]);
  assert.equal(
    execution.decisionRooms.find((candidate) => candidate.id === room.id)
      .status,
    "STALE",
  );
  assert.ok(!execution.frontier.includes("choose-seam"));
});

test("Decision Room form target and Evidence come from the same Assignment", () => {
  const input = nextDecisionRoomInput({
    decisionRequiredAssignmentIds: ["first-decision", "second-decision"],
    decisionRooms: [
      {
        assignmentId: "first-decision",
        status: "OPEN",
      },
    ],
    nodes: [
      {
        assignment: { id: "first-input" },
        dependsOn: [],
        evidenceRefs: ["evidence://first-input"],
      },
      {
        assignment: { id: "second-input" },
        dependsOn: [],
        evidenceRefs: ["evidence://second-input"],
      },
      {
        assignment: { id: "first-decision" },
        dependsOn: ["first-input"],
        evidenceRefs: [],
      },
      {
        assignment: { id: "second-decision" },
        dependsOn: ["second-input"],
        evidenceRefs: [],
      },
    ],
  });

  assert.deepEqual(input, {
    assignmentId: "second-decision",
    evidenceRefs: ["evidence://second-input"],
  });
});

test("Decision Room requires participant inputs, an expected output, and a reusable decision Artifact", () => {
  const execution = executionFor([
    task("decide-contract", {
      requiresDecision: true,
      workKind: "architecture",
      risk: "high",
    }),
  ]);
  const room = {
    id: "decision-room:contract",
    assignmentId: "decide-contract",
    assignmentAttempt: 1,
    question: "Which contract should own the execution boundary?",
    participantRoles: ["orchestrator", "sol_architect"],
    participantInputs: [
      {
        roleId: "orchestrator",
        contribution: "Keep admission and replay policy auditable",
        evidenceRefs: ["evidence://decision-contract"],
      },
      {
        roleId: "sol_architect",
        contribution: "Prefer one deep module with a narrow interface",
        evidenceRefs: ["evidence://decision-contract"],
      },
    ],
    expectedOutput: "A reusable architecture decision Artifact",
    alternatives: [
      {
        id: "deep-module",
        label: "Deep module",
        tradeoffs: ["Adds a seam", "Localizes invariants"],
      },
      {
        id: "inline",
        label: "Inline orchestration",
        tradeoffs: ["Fewer files", "Broadens replay surface"],
      },
    ],
    recommendation: {
      alternativeId: "deep-module",
      rationale: "Keep the policy local",
    },
    validationPlan: ["Replay forged admission events"],
  };
  const event = {
    type: "DECISION_ROOM_OPENED",
    actor: "mission-owner",
    evidenceRefs: ["evidence://decision-contract"],
    data: { decisionRoom: room },
  };

  const withoutExpectedOutput = structuredClone(event);
  delete withoutExpectedOutput.data.decisionRoom.expectedOutput;
  assert.throws(
    () => projectTaskExecutionEvent(execution, withoutExpectedOutput),
    /Decision Room expected output is required/,
  );

  const opened = projectTaskExecutionEvent(execution, event);
  assert.throws(
    () =>
      projectTaskExecutionEvent(opened, {
        type: "DECISION_ROOM_RESOLVED",
        actor: "mission-owner",
        evidenceRefs: [],
        data: {
          decision: {
            roomId: room.id,
            assignmentAttempt: 1,
            selectedAlternativeId: "deep-module",
            rationale: "The deep module contains replay risk",
          },
        },
      }),
    /Decision Room decision Artifact is required/,
  );

  const resolved = projectTaskExecutionEvent(opened, {
    type: "DECISION_ROOM_RESOLVED",
    actor: "mission-owner",
    evidenceRefs: [],
    data: {
      decision: {
        roomId: room.id,
        assignmentAttempt: 1,
        selectedAlternativeId: "deep-module",
        rationale: "The deep module contains replay risk",
        artifact: {
          id: "decision-artifact:contract",
          uri: "decision://contract",
          summary: "Use a deep module and verify forged admission events",
        },
      },
    },
  });
  assert.deepEqual(resolved.decisionRooms[0].decisionArtifact, {
    id: "decision-artifact:contract",
    uri: "decision://contract",
    summary: "Use a deep module and verify forged admission events",
    expectedOutput: "A reusable architecture decision Artifact",
    question: room.question,
    selectedAlternativeId: "deep-module",
    rationale: "The deep module contains replay risk",
    alternatives: room.alternatives,
    validationPlan: room.validationPlan,
    participantInputs: room.participantInputs,
  });
});

test("Decision Room requires a unique participant role set matching its inputs", () => {
  const execution = executionFor([
    task("decide-role-set", {
      requiresDecision: true,
      workKind: "architecture",
      risk: "high",
    }),
  ]);
  const room = {
    id: "decision-room:role-set",
    assignmentId: "decide-role-set",
    assignmentAttempt: 1,
    question: "Which role set should review the seam?",
    participantRoles: ["orchestrator", "orchestrator"],
    participantInputs: [
      {
        roleId: "orchestrator",
        contribution: "Keep the admission path auditable",
        evidenceRefs: ["evidence://decision-role-set"],
      },
      {
        roleId: "sol_architect",
        contribution: "Keep the invariant in one module",
        evidenceRefs: ["evidence://decision-role-set"],
      },
    ],
    expectedOutput: "A reusable role-set decision Artifact",
    alternatives: [
      {
        id: "explicit",
        label: "Explicit roles",
        tradeoffs: ["Clear ownership", "More validation"],
      },
      {
        id: "implicit",
        label: "Implicit roles",
        tradeoffs: ["Less input", "Unclear accountability"],
      },
    ],
    recommendation: {
      alternativeId: "explicit",
      rationale: "The role set must be replayable",
    },
    validationPlan: ["Replay the role set"],
  };

  assert.throws(
    () =>
      projectTaskExecutionEvent(execution, {
        type: "DECISION_ROOM_OPENED",
        actor: "mission-owner",
        evidenceRefs: ["evidence://decision-role-set"],
        data: { decisionRoom: room },
      }),
    /participant roles must be unique and match participant inputs/,
  );
});
