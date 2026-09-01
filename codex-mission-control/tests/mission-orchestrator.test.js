import assert from "node:assert/strict";
import test from "node:test";

import {
  MISSION_COMMAND_BY_ACTION,
  createLocalStorageEventStore,
  createMemoryEventStore,
  createBrowserWriteCoordinator,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";
import { createAgentRoutingAdapter } from "../src/agent-routing-adapter.js";

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

const boundedAssignment = {
  id: "assignment-001",
  goal: "Inventory Mission event types",
  acceptanceCriteria: ["Return every event type exactly once"],
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
  expectedEvidence: ["A sorted event type inventory"],
  workKind: "deterministic",
  risk: "low",
};

function releaseArtifact(name, uri) {
  return {
    name,
    uri,
    diff: `@@ ${name} @@\n+${name} candidate content`,
  };
}

const RELEASE_VALIDATION_GATES = Object.freeze([
  "unit-tests",
  "integration-tests",
]);

function releasePlan(overrides = {}) {
  return {
    residualRisk: "A rollback may still be required after deployment",
    intendedExternalAction: "Deploy the approved build to production",
    rollbackCommitment: "Restore the previous immutable release",
    requiredValidationGates: [...RELEASE_VALIDATION_GATES],
    ...overrides,
  };
}

function passingReleaseValidation(overrides = {}) {
  return {
    summary: "Release acceptance suite passed",
    gates: [
      {
        type: "unit-tests",
        status: "PASSED",
        outcome: "PASSED",
        evidenceRef: "evidence://validation-release-unit",
      },
      {
        type: "integration-tests",
        status: "PASSED",
        outcome: "PASSED",
        evidenceRef: "evidence://validation-release-integration",
      },
    ],
    ...overrides,
  };
}

function passingReleaseValidationEvidenceRefs() {
  return [
    "evidence://validation-release-unit",
    "evidence://validation-release-integration",
  ];
}

function releaseTaskGraph() {
  return {
    capacity: 4,
    coordinationRequired: true,
    assignments: [
      {
        ...boundedAssignment,
        id: "build-release-candidate",
        goal: "Build the bounded release candidate",
        dependsOn: [],
        workKind: "implementation",
        risk: "medium",
        effectivePermission: "workspace-write",
        ownershipBoundary: {
          readPaths: ["codex-mission-control/src"],
          writePaths: ["codex-mission-control/src"],
        },
        expectedEvidence: ["Inspectable release candidate and test Evidence"],
      },
      {
        ...boundedAssignment,
        id: "validate-release-unit",
        goal: "Run the declared unit-tests release gate",
        dependsOn: ["build-release-candidate"],
        validationGateType: "unit-tests",
        expectedEvidence: ["Transport-observed unit-tests outcome"],
      },
      {
        ...boundedAssignment,
        id: "validate-release-integration",
        goal: "Run the declared integration-tests release gate",
        dependsOn: ["build-release-candidate"],
        validationGateType: "integration-tests",
        expectedEvidence: ["Transport-observed integration-tests outcome"],
      },
      {
        ...boundedAssignment,
        id: "review-release-candidate",
        goal: "Independently review the exact release candidate",
        dependsOn: [
          "validate-release-unit",
          "validate-release-integration",
        ],
        workKind: "review",
        risk: "high",
        effectivePermission: "read-only",
        ownershipBoundary: {
          readPaths: ["codex-mission-control/src"],
          writePaths: [],
        },
        expectedEvidence: ["Structured independent review outcome"],
      },
    ],
  };
}

function createReleaseHarness(
  eventStore = createMemoryEventStore(),
  {
    candidateArtifacts = [
      releaseArtifact("release-candidate-1", "artifact://release-candidate-1"),
    ],
  } = {},
) {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const { assignment } = request;
        yield {
          kind: "started",
          runId: `run:${assignment.id}`,
          occurredAt: "2026-08-28T09:00:00.000Z",
        };
        if (assignment.id === "build-release-candidate") {
          yield {
            kind: "completed",
            runId: `run:${assignment.id}`,
            occurredAt: "2026-08-28T09:01:00.000Z",
            summary: "Built the exact release candidate",
            artifacts: structuredClone(candidateArtifacts),
            evidence: [
              {
                ref: "evidence://artifact-release-1",
                kind: "test",
                summary: "Candidate build and tests completed",
              },
            ],
          };
          return;
        }
        if (assignment.validationGateType) {
          const gateType = assignment.validationGateType;
          const evidenceRef = `evidence://validation-release-${
            gateType === "unit-tests" ? "unit" : "integration"
          }`;
          yield {
            kind: "completed",
            runId: `run:${assignment.id}`,
            occurredAt: "2026-08-28T09:01:30.000Z",
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
        assert.equal(assignment.id, "review-release-candidate");
        yield {
          kind: "completed",
          runId: `run:${assignment.id}`,
          occurredAt: "2026-08-28T09:02:00.000Z",
          summary: "Independent reviewer completed the release review",
          artifacts: [
            {
              name: "release-review-outcome",
              uri: "artifact://release-review-outcome",
              reviewOutcome: {
                outcome: "PASSED",
                candidateArtifactRefs: request.reviewContext.candidateArtifactRefs,
                findings: [],
              },
            },
          ],
          evidence: [
            {
              ref: "evidence://review-release-1",
              kind: "review",
              summary: "Independent Sol Reviewer passed the candidate",
            },
          ],
        };
      },
    },
  });
  return createHarness(eventStore, agentRouter);
}

const harnessEventStores = new WeakMap();

function createHarness(
  eventStore = createMemoryEventStore(),
  agentRouter = undefined,
) {
  let eventNumber = 0;

  const orchestrator = createMissionOrchestrator({
    eventStore,
    agentRouter,
    clock: () => "2026-07-28T08:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-001" : `event-${++eventNumber}`,
  });
  harnessEventStores.set(orchestrator, eventStore);
  return orchestrator;
}

const SOURCE_BACKED_CONTEXT_SOURCES = Object.freeze([
  {
    kind: "workspace-rules",
    ref: "AGENTS.md",
    status: "available",
  },
  {
    kind: "repository-state",
    ref: "git://working-tree",
    status: "available",
  },
  {
    kind: "recent-context",
    ref: "hotcache.md",
    status: "available",
  },
  {
    kind: "task-status",
    ref: "task-board.md",
    status: "available",
  },
  {
    kind: "decisions",
    ref: "docs/adr/decisions.md",
    status: "available",
  },
]);

function sourceBackedContext(summary) {
  return {
    summary,
    capturedAt: "2026-07-28T08:00:00.000Z",
    sources: structuredClone(SOURCE_BACKED_CONTEXT_SOURCES),
    facts: [
      {
        statement: `${summary} is grounded in the current repository state.`,
        sourceRefs: ["git://working-tree"],
      },
    ],
    assumptions: [],
  };
}

function projectedSourceBackedContext(summary, contextPackVersion) {
  return {
    ...sourceBackedContext(summary),
    contextPackVersion,
    sourceRefs: [
      "AGENTS.md",
      "git://working-tree",
      "hotcache.md",
      "task-board.md",
      "docs/adr/decisions.md",
    ],
  };
}

function advanceToPlanned(orchestrator, missionId) {
  orchestrator.execute(missionId, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Bounded source inspection"),
    },
    actor: "mission-owner",
    reason: "Capture the Context slice",
  });
  return orchestrator.execute(missionId, {
    type: "ACCEPT_PLAN",
    payload: { plan: { steps: ["route one bounded Assignment"] } },
    actor: "mission-owner",
    reason: "Accept the bounded routing plan",
  });
}

function createCompletedPlaybookMission(
  orchestrator,
  candidateFactory = playbookCandidateInputForMission,
) {
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with observable retrospective outcomes",
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
    {
      context: sourceBackedContext("Capture the completed Mission context"),
    },
    "Capture context",
  );
  const planned = execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["complete the bounded Mission"] } },
    "Accept plan",
  );
  const candidateInput = candidateFactory(created.id);
  const routing = createAgentRoutingAdapter({
    transport: { async *run() {} },
  }).route({
    ...boundedAssignment,
    contextSlice: planned.context,
  });
  const output = playbookEvaluationTransportOutput(candidateInput);
  const eventStore = harnessEventStores.get(orchestrator);
  const sourceEvents = [
    {
      schemaVersion: 3,
      id: "event-playbook-observation-routed",
      missionId: created.id,
      sequence: planned.events.length + 1,
      type: "ASSIGNMENT_ROUTED",
      actor: "mission-owner",
      occurredAt: "2026-08-25T09:00:00.000Z",
      reason: "Route the bounded Playbook observation through transport",
      contextPackVersion: planned.contextPackVersion,
      evidenceRefs: [],
      data: routing,
    },
    {
      schemaVersion: 3,
      id: "event-playbook-observation-started",
      missionId: created.id,
      sequence: planned.events.length + 2,
      type: "AGENT_RUN_STARTED",
      actor: `agent:${routing.agent.roleId}`,
      occurredAt: "2026-08-25T09:00:01.000Z",
      reason: "Start the bounded Playbook transport observation",
      contextPackVersion: planned.contextPackVersion,
      evidenceRefs: [],
      data: {
        run: {
          id: "run-playbook-observation",
          status: "WORKING",
          startedAt: "2026-08-25T09:00:01.000Z",
          updatedAt: "2026-08-25T09:00:01.000Z",
          summary: null,
          modelMetadata: null,
          evidence: [],
        },
      },
    },
    {
      schemaVersion: 3,
      id: "event-playbook-observation-completed",
      missionId: created.id,
      sequence: planned.events.length + 3,
      type: "AGENT_RUN_COMPLETED",
      actor: `agent:${routing.agent.roleId}`,
      occurredAt: "2026-08-25T09:01:00.000Z",
      reason: "Complete the bounded Playbook transport observation",
      contextPackVersion: planned.contextPackVersion,
      evidenceRefs: output.evidence.map((evidence) => evidence.ref),
      data: {
        run: {
          id: "run-playbook-observation",
          status: "COMPLETED",
          startedAt: "2026-08-25T09:00:01.000Z",
          updatedAt: "2026-08-25T09:01:00.000Z",
          summary: "Observed the bounded Playbook evaluation results",
          modelMetadata: null,
          evidence: output.evidence,
        },
        artifacts: output.artifacts,
      },
    },
  ];
  eventStore.append(created.id, sourceEvents, {
    expectedSequence: planned.events.length,
  });
  const completionCommands = [
    [
      "PASS_REVIEW",
      { review: { summary: "Mission review passed" } },
      "Pass Mission review",
      ["evidence://playbook-mission-review"],
    ],
    [
      "PASS_VALIDATION",
      { validation: { summary: "Mission validation passed" } },
      "Pass Mission validation",
      ["evidence://playbook-validation"],
    ],
    [
      "CAPTURE_LEARNING",
      { learning: { summary: "Record observed retry outcome" } },
      "Capture learning",
      ["evidence://playbook-learning"],
    ],
    [
      "COMPLETE_NO_RELEASE",
      { completion: { summary: "Complete the Mission" } },
      "Complete Mission",
      ["evidence://playbook-completion"],
    ],
  ];
  let completed;
  for (const [type, payload, reason, evidenceRefs] of completionCommands) {
    completed = execute(type, payload, reason, evidenceRefs);
  }
  return {
    candidateInput,
    created,
    completed,
    execute,
    sourceEvent: sourceEvents.at(-1),
  };
}

function playbookCandidateInputForMission(missionId) {
  const evaluationSet = {
    id: "evaluation-set:retry-guidance",
    version: "2026-08-25",
    caseIds: ["case:retry-evidence", "case:review-handoff"],
  };
  const protectedConfiguration = {
    systemPrompts: { missionPolicy: "Keep execution bounded and auditable." },
    agentProfiles: { reviewer: "sol_reviewer" },
    securityPolicy: { releaseRequiresHumanApproval: true },
  };
  const baselineMetrics = {
    acceptancePassRate: 0.8,
    criticalRegressions: 0,
    reviewFindings: 4,
    retries: 5,
    cycleTimeMs: 120000,
    tokenUse: 10000,
  };
  return {
    retrospective: {
      id: "retrospective:playbook-mission",
      version: "1",
      missionId,
      outcome: "COMPLETED",
      recurringFailurePattern: "Retry evidence is missing from repeated reviews.",
      metrics: structuredClone(baselineMetrics),
      evidenceRefs: ["evidence://playbook-retrospective"],
    },
    baseline: {
      id: "playbook:baseline",
      version: "1",
      evaluationSet: structuredClone(evaluationSet),
      protectedConfiguration: structuredClone(protectedConfiguration),
      metrics: structuredClone(baselineMetrics),
      criticalRegressionCaseIds: [],
      caseResults: [
        {
          caseId: "case:retry-evidence",
          artifactRef: "artifact://playbook/baseline/1/case-retry-evidence",
          evidenceRefs: [
            "evidence://playbook/baseline/1/case-retry-evidence",
          ],
          acceptanceScore: 0.8,
          criticalRegression: false,
          reviewFindings: 2,
          retries: 3,
          cycleTimeMs: 60000,
          tokenUse: 5000,
        },
        {
          caseId: "case:review-handoff",
          artifactRef: "artifact://playbook/baseline/1/case-review-handoff",
          evidenceRefs: [
            "evidence://playbook/baseline/1/case-review-handoff",
          ],
          acceptanceScore: 0.8,
          criticalRegression: false,
          reviewFindings: 2,
          retries: 2,
          cycleTimeMs: 60000,
          tokenUse: 5000,
        },
      ],
    },
    candidate: {
      id: "playbook:retry-guidance",
      version: "2",
      basedOn: { id: "playbook:baseline", version: "1" },
      evaluationSet: structuredClone(evaluationSet),
      protectedConfiguration: structuredClone(protectedConfiguration),
      change: {
        summary: "Add a retry-evidence checklist.",
        scope: "playbook procedure only",
      },
      metrics: {
        acceptancePassRate: 0.9,
        criticalRegressions: 0,
        reviewFindings: 2,
        retries: 3,
        cycleTimeMs: 100000,
        tokenUse: 9000,
      },
      criticalRegressionCaseIds: [],
      caseResults: [
        {
          caseId: "case:retry-evidence",
          artifactRef: "artifact://playbook/candidate/2/case-retry-evidence",
          evidenceRefs: [
            "evidence://playbook/candidate/2/case-retry-evidence",
          ],
          acceptanceScore: 0.9,
          criticalRegression: false,
          reviewFindings: 1,
          retries: 1,
          cycleTimeMs: 50000,
          tokenUse: 4500,
        },
        {
          caseId: "case:review-handoff",
          artifactRef: "artifact://playbook/candidate/2/case-review-handoff",
          evidenceRefs: [
            "evidence://playbook/candidate/2/case-review-handoff",
          ],
          acceptanceScore: 0.9,
          criticalRegression: false,
          reviewFindings: 1,
          retries: 2,
          cycleTimeMs: 50000,
          tokenUse: 4500,
        },
      ],
    },
    declaredTarget: {
      metric: "acceptancePassRate",
      minimumImprovement: 0.05,
    },
  };
}

// Production break caught: accepting caller-authored Playbook evaluation facts
// that have no transport-observed Mission provenance.
test("Playbook evaluation rejects caller-authored facts without transport-observed provenance", () => {
  const orchestrator = createHarness();
  const { created, execute } = createCompletedPlaybookMission(orchestrator);
  const eventsBefore = orchestrator.getMission(created.id).events.length;

  assert.throws(
    () =>
      execute(
        "EVALUATE_PLAYBOOK_CANDIDATE",
        { candidate: playbookCandidateInputForMission(created.id) },
        "Attempt to persist caller-authored Playbook facts",
      ),
    /Playbook evaluation .*caller-authored facts/i,
  );
  assert.equal(
    orchestrator.getMission(created.id).events.length,
    eventsBefore,
  );
});

function playbookEvaluationTransportOutput(candidateInput) {
  const caseResults = [
    ...candidateInput.baseline.caseResults,
    ...candidateInput.candidate.caseResults,
  ];
  const evidenceRefs = [
    ...candidateInput.retrospective.evidenceRefs,
    ...caseResults.flatMap((result) => result.evidenceRefs),
  ];
  return {
    artifacts: [
      {
        name: "playbook-evaluation-source",
        uri: "artifact://playbook-evaluation-source",
        playbookEvaluation: {
          schemaVersion: 1,
          ...structuredClone(candidateInput),
        },
      },
      ...caseResults.map((result) => ({
        name: `playbook-case-${result.caseId}`,
        uri: result.artifactRef,
        summary: `Observed result for ${result.caseId}`,
      })),
    ],
    evidence: evidenceRefs.map((ref) => ({
      ref,
      kind: "evaluation",
      summary: `Observed Playbook evaluation Evidence ${ref}`,
    })),
  };
}

function playbookEvaluationSourceSelector(sourceEvent) {
  return {
    eventId: sourceEvent.id,
    assignmentId: boundedAssignment.id,
    runId: sourceEvent.data.run.id,
    artifactRef: "artifact://playbook-evaluation-source",
  };
}

async function createTransportObservedCompletedPlaybookMission(
  candidateFactory = playbookCandidateInputForMission,
  outputFactory = playbookEvaluationTransportOutput,
) {
  let candidateInput;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-playbook-observation",
          occurredAt: "2026-08-25T09:00:00.000Z",
        };
        const output = outputFactory(candidateInput);
        yield {
          kind: "completed",
          runId: "run-playbook-observation",
          occurredAt: "2026-08-25T09:01:00.000Z",
          summary: "Observed the bounded Playbook evaluation results",
          ...output,
        };
      },
    },
  });
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore, agentRouter);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with transport-observed Playbook evaluation output",
  });
  advanceToPlanned(orchestrator, created.id);
  candidateInput = candidateFactory(created.id);
  await orchestrator.dispatchAssignment(created.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Observe the bounded Playbook evaluation through transport",
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
    "PASS_REVIEW",
    { review: { summary: "Mission review passed" } },
    "Pass the Mission review",
    ["evidence://transport-playbook-review"],
  );
  execute(
    "PASS_VALIDATION",
    { validation: { summary: "Mission validation passed" } },
    "Pass the Mission validation",
    ["evidence://transport-playbook-validation"],
  );
  execute(
    "CAPTURE_LEARNING",
    { learning: { summary: "Record the observed Playbook outcome" } },
    "Capture the Mission learning",
    ["evidence://transport-playbook-learning"],
  );
  const completed = execute(
    "COMPLETE_NO_RELEASE",
    { completion: { summary: "Complete the Mission" } },
    "Complete the Mission after observed evaluation",
    ["evidence://transport-playbook-completion"],
  );
  const sourceEvent = completed.events.find(
    (event) => event.type === "AGENT_RUN_COMPLETED",
  );
  return {
    candidateInput,
    completed,
    created,
    eventStore,
    execute,
    orchestrator,
    sourceEvent,
  };
}

test("Playbook evaluation derives stored facts from one transport-observed structured Artifact", async () => {
  const {
    candidateInput,
    created,
    execute,
    sourceEvent,
  } = await createTransportObservedCompletedPlaybookMission();

  const evaluated = execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: { source: playbookEvaluationSourceSelector(sourceEvent) } },
    "Evaluate only the current transport-observed Playbook output",
  );
  const evaluationEvent = evaluated.events.at(-1);

  assert.deepEqual(evaluated.playbook.retrospective, candidateInput.retrospective);
  assert.deepEqual(evaluated.playbook.baseline, candidateInput.baseline);
  assert.deepEqual(evaluated.playbook.candidate, candidateInput.candidate);
  assert.deepEqual(evaluationEvent.data.candidate, candidateInput);
  assert.deepEqual(evaluationEvent.data.evaluation, {
    schemaVersion: 1,
    missionId: created.id,
    contextPackVersion: 1,
    source: {
      eventId: sourceEvent.id,
      eventSequence: sourceEvent.sequence,
      eventType: "AGENT_RUN_COMPLETED",
      assignmentId: boundedAssignment.id,
      runId: "run-playbook-observation",
      artifactRef: "artifact://playbook-evaluation-source",
    },
  });
  assert.deepEqual(
    evaluationEvent.evidenceRefs,
    playbookEvaluationTransportOutput(candidateInput).evidence.map(
      (evidence) => evidence.ref,
    ),
  );
});

test("Playbook evaluation auto-selection fails closed without exactly one transport-observed structured Artifact", async () => {
  const noEvaluation = await createTransportObservedCompletedPlaybookMission(
    playbookCandidateInputForMission,
    (candidateInput) => {
      const output = playbookEvaluationTransportOutput(candidateInput);
      output.artifacts = output.artifacts.slice(1);
      return output;
    },
  );
  const noEvaluationEventsBefore = noEvaluation.orchestrator.getMission(
    noEvaluation.created.id,
  ).events.length;
  assert.throws(
    () =>
      noEvaluation.execute(
        "EVALUATE_PLAYBOOK_CANDIDATE",
        { candidate: {} },
        "Reject the absence of a transport-observed evaluation Artifact",
      ),
    /exactly one current transport-observed structured Artifact/,
  );
  assert.equal(
    noEvaluation.orchestrator.getMission(noEvaluation.created.id).events.length,
    noEvaluationEventsBefore,
  );

  const multipleEvaluations = await createTransportObservedCompletedPlaybookMission(
    playbookCandidateInputForMission,
    (candidateInput) => {
      const output = playbookEvaluationTransportOutput(candidateInput);
      output.artifacts.unshift({
        ...structuredClone(output.artifacts[0]),
        name: "duplicate-playbook-evaluation-source",
        uri: "artifact://duplicate-playbook-evaluation-source",
      });
      return output;
    },
  );
  const multipleEvaluationEventsBefore =
    multipleEvaluations.orchestrator.getMission(
      multipleEvaluations.created.id,
    ).events.length;
  assert.throws(
    () =>
      multipleEvaluations.execute(
        "EVALUATE_PLAYBOOK_CANDIDATE",
        { candidate: {} },
        "Reject ambiguous transport-observed evaluation Artifacts",
      ),
    /exactly one current transport-observed structured Artifact/,
  );
  assert.equal(
    multipleEvaluations.orchestrator.getMission(
      multipleEvaluations.created.id,
    ).events.length,
    multipleEvaluationEventsBefore,
  );
});

test("Playbook evaluation rejects case references outside the selected transport-observed output", async () => {
  const scenarios = [
    {
      name: "an unobserved case Artifact",
      mutate(output) {
        output.artifacts[0].playbookEvaluation.baseline.caseResults[0].artifactRef =
          "artifact://pasted-case-observation";
      },
    },
    {
      name: "an unobserved case Evidence reference",
      mutate(output) {
        output.artifacts[0].playbookEvaluation.candidate.caseResults[0].evidenceRefs = [
          "evidence://pasted-case-observation",
        ];
      },
    },
    {
      name: "a duplicate case Artifact reference",
      mutate(output) {
        output.artifacts[0].playbookEvaluation.candidate.caseResults[0].artifactRef =
          output.artifacts[0].playbookEvaluation.baseline.caseResults[0].artifactRef;
      },
    },
  ];

  for (const scenario of scenarios) {
    const observedMission =
      await createTransportObservedCompletedPlaybookMission(
        playbookCandidateInputForMission,
        (candidateInput) => {
          const output = playbookEvaluationTransportOutput(candidateInput);
          scenario.mutate(output);
          return output;
        },
      );
    const eventsBefore = observedMission.orchestrator.getMission(
      observedMission.created.id,
    ).events.length;
    assert.throws(
      () =>
        observedMission.execute(
          "EVALUATE_PLAYBOOK_CANDIDATE",
          { candidate: {} },
          `Reject ${scenario.name}`,
        ),
      /case Artifacts and Evidence must resolve|case Artifact references must be distinct/i,
    );
    assert.equal(
      observedMission.orchestrator.getMission(observedMission.created.id)
        .events.length,
      eventsBefore,
    );
  }
});

test("Playbook evaluation rejects pasted claims and forged transport-observed selectors without appending", async () => {
  const {
    candidateInput,
    created,
    execute,
    orchestrator,
    sourceEvent,
  } = await createTransportObservedCompletedPlaybookMission();
  const source = playbookEvaluationSourceSelector(sourceEvent);
  const scenarios = [
    {
      name: "pasted metrics",
      payload: { candidate: { metrics: candidateInput.candidate.metrics } },
    },
    {
      name: "pasted case results",
      payload: {
        candidate: {
          caseResults: candidateInput.candidate.caseResults,
        },
      },
    },
    {
      name: "pasted retrospective Evidence",
      payload: {
        candidate: {
          retrospective: {
            evidenceRefs: ["evidence://pasted-retrospective"],
          },
        },
      },
    },
    {
      name: "pasted Mission ID",
      payload: { candidate: { missionId: "mission-other" } },
    },
    {
      name: "forged source Artifact",
      payload: {
        candidate: {
          source: {
            ...source,
            artifactRef: "artifact://pasted-source",
          },
        },
      },
    },
  ];

  for (const scenario of scenarios) {
    const eventsBefore = orchestrator.getMission(created.id).events.length;
    assert.throws(
      () =>
        execute(
          "EVALUATE_PLAYBOOK_CANDIDATE",
          scenario.payload,
          `Attempt ${scenario.name}`,
        ),
      /Playbook evaluation/i,
      scenario.name,
    );
    assert.equal(
      orchestrator.getMission(created.id).events.length,
      eventsBefore,
      `${scenario.name} must not append an evaluation event`,
    );
  }
});

test("Playbook evaluation replay rejects forged transport-observed provenance and snapshots", async () => {
  const {
    created,
    eventStore,
    execute,
    sourceEvent,
  } = await createTransportObservedCompletedPlaybookMission();
  const evaluated = execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: { source: playbookEvaluationSourceSelector(sourceEvent) } },
    "Persist the current observed evaluation",
  );
  const mutateEvaluation = (mutator) => {
    const events = structuredClone(evaluated.events);
    mutator(events.at(-1));
    return createHarness(
      createMemoryEventStore({ [created.id]: events }),
    );
  };

  for (const mutate of [
    (event) => {
      event.data.candidate.candidate.metrics.tokenUse += 1;
    },
    (event) => {
      event.data.candidate.retrospective.evidenceRefs = [
        "evidence://forged-retrospective",
      ];
    },
    (event) => {
      event.data.evaluation.missionId = "mission-other";
    },
    (event) => {
      event.data.evaluation.source.artifactRef = "artifact://forged-source";
    },
  ]) {
    assert.throws(
      () => mutateEvaluation(mutate).getMission(created.id),
      /Playbook|transport-observed/i,
    );
  }
  assert.deepEqual(eventStore.load(created.id), evaluated.events);
});

function independentPlaybookReview(candidateInput, overrides = {}) {
  return {
    decision: "APPROVED",
    reviewer: "sol_reviewer",
    independent: true,
    effectivePermission: "read-only",
    candidateId: candidateInput.candidate.id,
    candidateVersion: candidateInput.candidate.version,
    baseline: {
      id: candidateInput.baseline.id,
      version: candidateInput.baseline.version,
    },
    evaluationSet: structuredClone(candidateInput.candidate.evaluationSet),
    findings: [],
    rationale: "The comparison has no new critical regression.",
    ...overrides,
  };
}

function createPlaybookReviewHarness(
  eventStore = createMemoryEventStore(),
) {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request);
      },
    },
  });
  return createHarness(eventStore, agentRouter);
}

function dispatchPlaybookReview(orchestrator, missionId) {
  return orchestrator.dispatchPlaybookIndependentReview(missionId, {
    actor: "mission-owner",
    reason: "Dispatch the current Playbook Candidate for independent review",
  });
}

function createLegacyReleaseMissionInReview(orchestrator) {
  const created = orchestrator.createMission({
    brief: {
      ...validBrief,
      releaseRequired: true,
      releaseAuthorized: true,
      releaseAuthority: "release-owner",
      releasePlan: releasePlan(),
    },
    actor: "mission-owner",
    reason: "Start a legacy release Mission for a fail-closed check",
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
    { context: sourceBackedContext("Release Context Pack") },
    "Capture release Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "validate", "approve"] } },
    "Accept legacy release plan",
  );
  execute(
    "START_RUN",
    { run: { id: "run-release-1", agentRole: "terra_builder" } },
    "Start release candidate",
  );
  execute(
    "SUBMIT_ARTIFACT",
    {
      artifact: releaseArtifact(
        "release-candidate-1",
        "artifact://release-candidate-1",
      ),
    },
    "Submit exact release candidate",
    ["evidence://artifact-release-1"],
  );
  return { created, execute };
}

async function createReleaseMissionAtApproval(
  orchestrator,
  { stopBeforeReview = false, stopBeforeValidation = false } = {},
) {
  const releaseBrief = {
    ...validBrief,
    releaseRequired: true,
    releaseAuthorized: true,
    releaseAuthority: "release-owner",
    releasePlan: releasePlan(),
  };
  const created = orchestrator.createMission({
    brief: releaseBrief,
    actor: "mission-owner",
    reason: "Start a release Mission that requires human approval",
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
    { context: sourceBackedContext("Release Context Pack") },
    "Capture release Context",
  );
  execute(
    "ACCEPT_PLAN",
    {
      plan: {
        steps: ["build", "review", "validate", "approve"],
        taskGraph: releaseTaskGraph(),
      },
    },
    "Accept release plan with independent review",
  );
  await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the candidate build through the transport",
  });
  await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the declared release validation gates through transport",
  });
  const reviewed = await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the independent reviewer through the transport",
  });
  const reviewer = reviewed.execution.nodes.find(
    (node) => node.assignment.id === "review-release-candidate",
  );
  if (!stopBeforeReview) {
    execute(
      "PASS_REVIEW",
      {
        review: {
          summary: "Independent review passed",
          reviewerAssignmentId: reviewer.assignment.id,
          outcome: reviewer.reviewOutcome.outcome,
          candidateArtifactRefs: reviewer.reviewOutcome.candidateArtifactRefs,
          findings: reviewer.reviewOutcome.findings,
        },
      },
      "Record the transport-observed independent review",
      reviewer.evidenceRefs,
      "agent:sol_reviewer",
    );
  }
  return {
    created,
    execute,
    reviewed,
    approvalRequired:
      stopBeforeReview || stopBeforeValidation
        ? null
        : execute(
            "PASS_VALIDATION",
            { validation: passingReleaseValidation() },
            "Record every required release validation gate",
            passingReleaseValidationEvidenceRefs(),
          ),
  };
}

function expectedReleaseReadiness(candidateArtifacts) {
  return {
    candidate: candidateArtifacts[0],
    candidateArtifacts,
    contextPackVersion: 1,
    evidenceRefs: [
      "evidence://artifact-release-1",
      "evidence://review-release-1",
      ...passingReleaseValidationEvidenceRefs(),
    ],
    validation: {
      summary: "Release acceptance suite passed",
      gates: passingReleaseValidation().gates,
      evidenceRefs: passingReleaseValidationEvidenceRefs(),
    },
    ...releasePlan(),
  };
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
    execution: null,
    executionReviewEvidenceRefs: null,
    run: null,
    artifact: null,
    review: null,
    validation: null,
    releaseReadiness: null,
    approval: null,
    learning: null,
    completion: null,
    playbook: {
      status: "NOT_EVALUATED",
      retrospective: null,
      baseline: null,
      candidate: null,
      declaredTarget: null,
      comparison: null,
      reviewDispatch: null,
      independentReview: null,
      humanDecision: null,
      promotedVersions: [],
      rejectionHistory: [],
      rollbackHistory: [],
      reviewRejectionHistory: [],
      decisionHistory: [],
      activePromotedVersionId: null,
    },
    events: [
      {
        schemaVersion: 3,
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
    allowedActions: ["capture_context", "block_mission", "cancel_mission"],
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

test("release-required Brief is accepted only with an explicit bounded release plan", () => {
  const orchestrator = createHarness();
  const releaseBrief = {
    ...validBrief,
    releaseRequired: true,
    releaseAuthorized: true,
    releaseAuthority: "release-owner",
    releasePlan: releasePlan(),
  };
  assert.throws(
    () =>
      orchestrator.createMission({
        brief: {
          ...validBrief,
          releaseRequired: true,
          releaseAuthority: "release-owner",
        },
        actor: "mission-owner",
        reason: "Attempt release without an authorized release plan",
      }),
    /Release-required Brief is missing releasePlan/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);
  assert.throws(
    () =>
      orchestrator.createMission({
        brief: {
          ...releaseBrief,
          releaseAuthorized: false,
        },
        actor: "mission-owner",
        reason: "Attempt release without explicit Brief authorization",
      }),
    /Release-required Brief must explicitly authorize release/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);

  const mission = orchestrator.createMission({
    brief: releaseBrief,
    actor: "mission-owner",
    reason: "Start a human-controlled release Mission",
  });

  assert.deepEqual(
    {
      status: mission.status,
      brief: mission.brief,
      approval: mission.approval,
      allowedActions: mission.allowedActions,
      eventTypes: mission.events.map((event) => event.type),
    },
    {
      status: "BRIEF_ACCEPTED",
      brief: releaseBrief,
      approval: null,
      allowedActions: [
        "capture_context",
        "block_mission",
        "cancel_mission",
      ],
      eventTypes: ["MISSION_CREATED"],
    },
  );
});

test("release-required Brief declares the typed validation gates needed for approval", () => {
  const orchestrator = createHarness();

  assert.throws(
    () =>
      orchestrator.createMission({
        brief: {
          ...validBrief,
          releaseRequired: true,
          releaseAuthorized: true,
          releaseAuthority: "release-owner",
          releasePlan: {
            residualRisk: "A rollback may still be required after deployment",
            intendedExternalAction: "Deploy the approved build to production",
            rollbackCommitment: "Restore the previous immutable release",
          },
        },
        actor: "mission-owner",
        reason: "Attempt release without declared validation gates",
      }),
    /Release-required Brief requires unique validation gate types/,
  );
  assert.deepEqual(orchestrator.listMissions(), []);
});

test("current transport-observed review and typed gates move a release-required Mission into human approval", async () => {
  const orchestrator = createReleaseHarness();
  const { approvalRequired, reviewed } = await createReleaseMissionAtApproval(
    orchestrator,
  );

  assert.deepEqual(
    {
      status: approvalRequired.status,
      releaseReadiness: approvalRequired.releaseReadiness,
      allowedActions: approvalRequired.allowedActions,
      latestEventType: approvalRequired.events.at(-1).type,
    },
    {
      status: "APPROVAL_REQUIRED",
      releaseReadiness: expectedReleaseReadiness([
        releaseArtifact("release-candidate-1", "artifact://release-candidate-1"),
      ]),
      allowedActions: [
        "approve_release",
        "reject_release",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEventType: "VALIDATION_PASSED",
    },
  );
  assert.deepEqual(
    reviewed.execution.nodes.find(
      (node) => node.assignment.id === "review-release-candidate",
    ).agent,
    {
      roleId: "sol_reviewer",
      roleName: "Sol Reviewer",
      capability: "review",
      effectivePermission: "read-only",
      independent: true,
    },
  );
});

test("release-required Mission without a Task Graph cannot self-certify review", () => {
  const orchestrator = createHarness();
  const { created, execute } = createLegacyReleaseMissionInReview(orchestrator);
  const eventCount = orchestrator.getMission(created.id).events.length;

  assert.throws(
    () =>
      execute(
        "PASS_REVIEW",
        { review: { summary: "Mission owner claims review passed" } },
        "Attempt an owner-authored release review",
        ["evidence://owner-authored-review"],
      ),
    /release-required review requires transport-bound independent reviewer Evidence/,
  );
  assert.equal(orchestrator.getMission(created.id).events.length, eventCount);
  assert.equal(orchestrator.getMission(created.id).status, "IN_REVIEW");
});

test("release Plan requires one validation Assignment per declared gate", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: {
      ...validBrief,
      releaseRequired: true,
      releaseAuthorized: true,
      releaseAuthority: "release-owner",
      releasePlan: releasePlan(),
    },
    actor: "mission-owner",
    reason: "Start a release Mission",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: { context: sourceBackedContext("Release Context Pack") },
    actor: "mission-owner",
    reason: "Capture release Context",
  });
  const graphWithoutValidation = releaseTaskGraph();
  graphWithoutValidation.assignments = graphWithoutValidation.assignments
    .filter((assignment) => assignment.validationGateType === undefined)
    .map((assignment) =>
      assignment.id === "review-release-candidate"
        ? { ...assignment, dependsOn: ["build-release-candidate"] }
        : assignment,
    );

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "ACCEPT_PLAN",
        payload: {
          plan: {
            steps: ["build", "review", "validate"],
            taskGraph: graphWithoutValidation,
          },
        },
        actor: "mission-owner",
        reason: "Attempt a release Plan without validation work",
      }),
    /one validation Assignment per declared gate/i,
  );
});

test("release validation rejects missing, extra, and duplicate declared gate types", async () => {
  const runValidation = async (validation, evidenceRefs) => {
    const orchestrator = createReleaseHarness();
    const { created, execute } = await createReleaseMissionAtApproval(
      orchestrator,
      { stopBeforeValidation: true },
    );
    const eventCount = orchestrator.getMission(created.id).events.length;
    return {
      execute: () =>
        execute(
          "PASS_VALIDATION",
          { validation },
          "Attempt an incomplete or non-exact release validation",
          evidenceRefs,
        ),
      eventCount,
      orchestrator,
      missionId: created.id,
    };
  };

  const missing = await runValidation(
    {
      ...passingReleaseValidation(),
      gates: [passingReleaseValidation().gates[0]],
    },
    ["evidence://validation-release-unit"],
  );
  assert.throws(missing.execute, /exact declared validation gate types/);
  assert.equal(
    missing.orchestrator.getMission(missing.missionId).events.length,
    missing.eventCount,
  );

  const extra = await runValidation(
    {
      ...passingReleaseValidation(),
      gates: [
        ...passingReleaseValidation().gates,
        {
          type: "browser-smoke",
          status: "PASSED",
          outcome: "PASSED",
          evidenceRef: "evidence://validation-release-browser",
        },
      ],
    },
    [
      ...passingReleaseValidationEvidenceRefs(),
      "evidence://validation-release-browser",
    ],
  );
  assert.throws(extra.execute, /exact declared validation gate types/);

  const duplicate = await runValidation(
    {
      ...passingReleaseValidation(),
      gates: [
        passingReleaseValidation().gates[0],
        {
          ...passingReleaseValidation().gates[0],
          evidenceRef: "evidence://validation-release-unit-duplicate",
        },
      ],
    },
    [
      "evidence://validation-release-unit",
      "evidence://validation-release-unit-duplicate",
    ],
  );
  assert.throws(duplicate.execute, /exact declared validation gate types/);
});

test("release validation rejects non-passing and unbound typed gate Evidence", async () => {
  const runValidation = async (validation, evidenceRefs) => {
    const orchestrator = createReleaseHarness();
    const { execute } = await createReleaseMissionAtApproval(orchestrator, {
      stopBeforeValidation: true,
    });
    return () =>
      execute(
        "PASS_VALIDATION",
        { validation },
        "Attempt a non-passing or Evidence-unbound release validation",
        evidenceRefs,
      );
  };

  assert.throws(
    await runValidation(
      {
        ...passingReleaseValidation(),
        gates: [
          {
            ...passingReleaseValidation().gates[0],
            outcome: "FAILED",
          },
          passingReleaseValidation().gates[1],
        ],
      },
      passingReleaseValidationEvidenceRefs(),
    ),
    /non-passing validation gate outcome/,
  );

  assert.throws(
    await runValidation(
      {
        ...passingReleaseValidation(),
        gates: [
          {
            ...passingReleaseValidation().gates[0],
            evidenceRef: "evidence://forged-validation-unit",
          },
          passingReleaseValidation().gates[1],
        ],
      },
      passingReleaseValidationEvidenceRefs(),
    ),
    /typed validation gate Evidence must exactly match event Evidence/,
  );

  assert.throws(
    await runValidation(
      {
        ...passingReleaseValidation(),
        gates: [
          passingReleaseValidation().gates[0],
          {
            ...passingReleaseValidation().gates[1],
            evidenceRef: "evidence://validation-release-unit",
          },
        ],
      },
      passingReleaseValidationEvidenceRefs(),
    ),
    /typed validation gate Evidence must exactly match event Evidence/,
  );
});

test("release validation rejects self-consistent gate refs that transport never observed", async () => {
  const orchestrator = createReleaseHarness();
  const { execute } = await createReleaseMissionAtApproval(orchestrator, {
    stopBeforeValidation: true,
  });

  assert.throws(
    () =>
      execute(
        "PASS_VALIDATION",
        {
          validation: {
            ...passingReleaseValidation(),
            gates: passingReleaseValidation().gates.map((gate) => ({
              ...gate,
              evidenceRef: `${gate.evidenceRef}-invented`,
            })),
          },
        },
        "Attempt to self-certify validation with invented Evidence",
        passingReleaseValidationEvidenceRefs().map(
          (reference) => `${reference}-invented`,
        ),
      ),
    /transport-observed validation gate Evidence/,
  );
});

test("release validation fails closed when a candidate has no inspectable detail", async () => {
  const orchestrator = createReleaseHarness(createMemoryEventStore(), {
    candidateArtifacts: [
      {
        name: "opaque-release-candidate",
        uri: "artifact://opaque-release-candidate",
      },
    ],
  });
  const { created, execute } = await createReleaseMissionAtApproval(
    orchestrator,
    { stopBeforeValidation: true },
  );

  assert.throws(
    () =>
      execute(
        "PASS_VALIDATION",
        { validation: passingReleaseValidation() },
        "Pass release validation",
        passingReleaseValidationEvidenceRefs(),
      ),
    /release-required candidate Artifacts must include inline diff, patch, or content before approval/,
  );

  const mission = orchestrator.getMission(created.id);
  assert.equal(mission.status, "VALIDATING");
  assert.equal(mission.events.at(-1).type, "REVIEW_PASSED");

  const referenceOrchestrator = createReleaseHarness(createMemoryEventStore(), {
    candidateArtifacts: [
      {
        name: "reference-only-release-candidate",
        uri: "artifact://reference-only-release-candidate",
        diff: "src/release-candidate.diff",
      },
    ],
  });
  const { execute: executeReference } = await createReleaseMissionAtApproval(
    referenceOrchestrator,
    { stopBeforeValidation: true },
  );
  assert.throws(
    () =>
      executeReference(
        "PASS_VALIDATION",
        { validation: passingReleaseValidation() },
        "Pass release validation with a reference-only diff",
        passingReleaseValidationEvidenceRefs(),
      ),
    /release-required candidate Artifacts must include inline diff, patch, or content before approval/,
  );
});

test("passing release gates reject explicit failed outcomes and reused Evidence", async () => {
  const reviewOrchestrator = createReleaseHarness();
  const {
    created: reviewMission,
    execute: executeReview,
    reviewed: reviewedRelease,
  } = await createReleaseMissionAtApproval(reviewOrchestrator, {
      stopBeforeReview: true,
    });

  assert.throws(
    () =>
      executeReview(
        "PASS_REVIEW",
        { review: { summary: "Review failed", outcome: "FAILED" } },
        "Attempt to pass a failed review",
        ["evidence://review-release-1"],
      ),
    /non-passing review outcome/,
  );
  assert.throws(
    () =>
      executeReview(
        "PASS_REVIEW",
        {
          review: {
            summary: "Review failed",
            details: { outcome: "FAILED" },
          },
        },
        "Attempt to pass a nested failed review",
        ["evidence://review-release-1b"],
      ),
    /non-passing review details.outcome/,
  );
  assert.equal(reviewOrchestrator.getMission(reviewMission.id).status, "IN_REVIEW");

  const validationOrchestrator = createReleaseHarness();
  const { created: validationMission, execute: executeValidation } =
    await createReleaseMissionAtApproval(validationOrchestrator, {
      stopBeforeValidation: true,
    });
  assert.throws(
    () =>
      executeValidation(
        "PASS_VALIDATION",
        { validation: { summary: "Validation failed", outcome: "FAILED" } },
        "Attempt to pass failed validation",
        ["evidence://validation-release-1"],
      ),
    /non-passing validation outcome/,
  );
  assert.throws(
    () =>
      executeValidation(
        "PASS_VALIDATION",
        {
          validation: {
            summary: "Validation failed",
            details: { status: "FAILED" },
          },
        },
        "Attempt to pass nested failed validation",
        ["evidence://validation-release-1b"],
      ),
    /non-passing validation details.status/,
  );
  assert.equal(
    validationOrchestrator.getMission(validationMission.id).status,
    "VALIDATING",
  );

  const duplicateOrchestrator = createReleaseHarness();
  const { created: duplicateMission, execute: executeDuplicate } =
    await createReleaseMissionAtApproval(duplicateOrchestrator, {
      stopBeforeReview: true,
    });
  const reviewer = reviewedRelease.execution.nodes.find(
    (node) => node.assignment.id === "review-release-candidate",
  );
  assert.throws(
    () =>
      executeDuplicate(
        "PASS_REVIEW",
        {
          review: {
            summary: "Independent review passed",
            reviewerAssignmentId: reviewer.assignment.id,
            outcome: reviewer.reviewOutcome.outcome,
            candidateArtifactRefs: reviewer.reviewOutcome.candidateArtifactRefs,
            findings: reviewer.reviewOutcome.findings,
          },
        },
        "Attempt to reuse Artifact Evidence for review",
        ["evidence://artifact-release-1"],
      ),
    /current passing structured reviewer outcome, independent Sol Reviewer Evidence, and actor/,
  );
  assert.equal(
    duplicateOrchestrator.getMission(duplicateMission.id).status,
    "IN_REVIEW",
  );

  const validationDuplicateOrchestrator = createReleaseHarness();
  const {
    created: validationDuplicateMission,
    execute: executeValidationDuplicate,
  } = await createReleaseMissionAtApproval(validationDuplicateOrchestrator, {
    stopBeforeValidation: true,
  });
  assert.throws(
    () =>
      executeValidationDuplicate(
        "PASS_VALIDATION",
        {
          validation: {
            ...passingReleaseValidation(),
            gates: [
              {
                ...passingReleaseValidation().gates[0],
                evidenceRef: "evidence://review-release-1",
              },
              passingReleaseValidation().gates[1],
            ],
          },
        },
        "Attempt to reuse Review Evidence for validation",
        [
          "evidence://review-release-1",
          "evidence://validation-release-integration",
        ],
      ),
    /Evidence refs distinct from earlier release gates/,
  );
  assert.equal(
    validationDuplicateOrchestrator.getMission(validationDuplicateMission.id)
      .status,
    "VALIDATING",
  );
});

test("authorized human approval records the exact candidate without releasing it", async () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createReleaseHarness(eventStore);
  const { created, execute, approvalRequired } =
    await createReleaseMissionAtApproval(orchestrator);

  const ready = execute(
    "APPROVE_RELEASE",
    { approval: { summary: "Approve this exact candidate for release" } },
    "Release owner accepts the current residual risk",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );
  const replayed = createReleaseHarness(eventStore).getMission(created.id);
  const expectedApproval = {
    decision: "APPROVED",
    summary: "Approve this exact candidate for release",
    ...expectedReleaseReadiness([
      releaseArtifact("release-candidate-1", "artifact://release-candidate-1"),
    ]),
  };

  assert.deepEqual(
    {
      status: ready.status,
      approval: ready.approval,
      allowedActions: ready.allowedActions,
      latestEvent: {
        type: ready.events.at(-1).type,
        actor: ready.events.at(-1).actor,
        evidenceRefs: ready.events.at(-1).evidenceRefs,
        approval: ready.events.at(-1).data.approval,
      },
      emittedExternalAction: ready.events.some((event) =>
        ["RELEASED", "DEPLOYED", "PUSHED", "PULL_REQUEST_OPENED"].includes(
          event.type,
        ),
      ),
      replayedStatus: replayed.status,
      replayedApproval: replayed.approval,
    },
    {
      status: "READY_TO_RELEASE",
      approval: expectedApproval,
      allowedActions: [
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEvent: {
        type: "RELEASE_APPROVED",
        actor: "release-owner",
        evidenceRefs: expectedApproval.evidenceRefs,
        approval: expectedApproval,
      },
      emittedExternalAction: false,
      replayedStatus: "READY_TO_RELEASE",
      replayedApproval: expectedApproval,
    },
  );
});

test("release approval snapshots every Artifact in a connected candidate set", async () => {
  const candidateArtifacts = [
    releaseArtifact("application", "artifact://release/application"),
    releaseArtifact("migration", "artifact://release/migration"),
  ];
  const orchestrator = createReleaseHarness(createMemoryEventStore(), {
    candidateArtifacts,
  });
  const { created, approvalRequired } = await createReleaseMissionAtApproval(
    orchestrator,
  );
  const approved = orchestrator.execute(created.id, {
    type: "APPROVE_RELEASE",
    payload: { approval: { summary: "Approve the complete Artifact set" } },
    actor: "release-owner",
    reason: "Approve application and migration as one candidate",
    evidenceRefs: approvalRequired.releaseReadiness.evidenceRefs,
  });

  assert.deepEqual(
    {
      readinessArtifacts:
        approvalRequired.releaseReadiness.candidateArtifacts,
      approvalArtifacts: approved.approval.candidateArtifacts,
      primaryCandidate: approved.approval.candidate,
    },
    {
      readinessArtifacts: [
        releaseArtifact("application", "artifact://release/application"),
        releaseArtifact("migration", "artifact://release/migration"),
      ],
      approvalArtifacts: [
        releaseArtifact("application", "artifact://release/application"),
        releaseArtifact("migration", "artifact://release/migration"),
      ],
      primaryCandidate: releaseArtifact(
        "application",
        "artifact://release/application",
      ),
    },
  );
});

test("authorized human rejection invalidates the exact release candidate", async () => {
  const orchestrator = createReleaseHarness();
  const { execute, approvalRequired } = await createReleaseMissionAtApproval(
    orchestrator,
  );

  const rejected = execute(
    "REJECT_RELEASE",
    { approval: { summary: "Rollback evidence needs more detail" } },
    "Release owner rejects the current candidate",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );

  assert.deepEqual(
    {
      status: rejected.status,
      approval: rejected.approval,
      changeRequest: rejected.changeRequest,
      releaseReadiness: rejected.releaseReadiness,
      invalidatedArtifactRefs: rejected.invalidatedArtifactRefs,
      invalidatedEvidenceRefs: rejected.invalidatedEvidenceRefs,
      allowedActions: rejected.allowedActions,
      latestEventType: rejected.events.at(-1).type,
    },
    {
      status: "CHANGES_REQUESTED",
      approval: {
        decision: "REJECTED",
        summary: "Rollback evidence needs more detail",
        ...expectedReleaseReadiness([
          releaseArtifact(
            "release-candidate-1",
            "artifact://release-candidate-1",
          ),
        ]),
      },
      changeRequest: {
        source: "APPROVAL",
        reason: "Rollback evidence needs more detail",
        evidenceRefs: expectedReleaseReadiness([
          releaseArtifact(
            "release-candidate-1",
            "artifact://release-candidate-1",
          ),
        ]).evidenceRefs,
        requestedAtSequence: rejected.events.at(-1).sequence,
      },
      releaseReadiness: null,
      invalidatedArtifactRefs: ["artifact://release-candidate-1"],
      invalidatedEvidenceRefs: expectedReleaseReadiness([
        releaseArtifact("release-candidate-1", "artifact://release-candidate-1"),
      ]).evidenceRefs,
      allowedActions: [
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEventType: "RELEASE_REJECTED",
    },
  );
});

test("release rejection invalidates the old candidate Evidence for replay", async () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createReleaseHarness(eventStore);
  const { created, execute, approvalRequired } =
    await createReleaseMissionAtApproval(orchestrator);
  const rejected = execute(
    "REJECT_RELEASE",
    { approval: { summary: "Release evidence requires correction" } },
    "Release owner returns the candidate for correction",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );
  const staleApproval = {
    schemaVersion: 2,
    id: "event-stale-release-approval",
    missionId: created.id,
    sequence: rejected.events.length + 1,
    type: "RELEASE_APPROVED",
    actor: "release-owner",
    occurredAt: "2026-08-28T09:03:00.000Z",
    reason: "Attempt to restore invalidated approval Evidence",
    contextPackVersion: 1,
    evidenceRefs: approvalRequired.releaseReadiness.evidenceRefs,
    data: {
      approval: {
        decision: "APPROVED",
        summary: "Attempt to restore invalidated approval Evidence",
        ...approvalRequired.releaseReadiness,
      },
    },
  };
  const replay = createReleaseHarness(
    createMemoryEventStore({
      [created.id]: [...rejected.events, staleApproval],
    }),
  );

  assert.ok(
    rejected.invalidatedEvidenceRefs.includes(
      "evidence://validation-release-unit",
    ),
  );
  assert.throws(
    () => replay.getMission(created.id),
    /RELEASE_APPROVED is not allowed while Mission is CHANGES_REQUESTED/,
  );
});

test("approval authority and replay fail closed for missing, duplicate, out-of-order, or stale decisions", async () => {
  const orchestrator = createReleaseHarness();
  const { created, execute, approvalRequired } =
    await createReleaseMissionAtApproval(orchestrator);
  const eventCount = approvalRequired.events.length;
  assert.throws(
    () =>
      execute(
        "APPROVE_RELEASE",
        { approval: { summary: "Unauthorized approval attempt" } },
        "A non-authority attempts approval",
        approvalRequired.releaseReadiness.evidenceRefs,
        "mission-owner",
      ),
    /APPROVE_RELEASE requires release authority release-owner/,
  );
  assert.equal(orchestrator.getMission(created.id).events.length, eventCount);

  const approvalSnapshot = {
    decision: "APPROVED",
    summary: "Approve exact release candidate",
    ...approvalRequired.releaseReadiness,
  };
  const approvalEvent = {
    id: "event-forged-approval",
    missionId: created.id,
    sequence: approvalRequired.events.length + 1,
    type: "RELEASE_APPROVED",
    actor: "release-owner",
    occurredAt: "2026-07-30T14:00:00.000Z",
    reason: "Forged release approval",
    contextPackVersion: 1,
    evidenceRefs: [...approvalRequired.releaseReadiness.evidenceRefs],
    data: { approval: approvalSnapshot },
  };
  const replay = (events) =>
    createMissionOrchestrator({
      eventStore: createMemoryEventStore({ [created.id]: events }),
    }).getMission(created.id);
  const missingDecision = {
    ...approvalEvent,
    id: "event-missing-approval",
    data: {},
  };
  const staleDecision = {
    ...approvalEvent,
    id: "event-stale-approval",
    evidenceRefs: [
      "evidence://artifact-release-stale",
      "evidence://review-release-1",
      ...passingReleaseValidationEvidenceRefs(),
    ],
  };
  const tamperedGateDeclaration = {
    ...approvalEvent,
    id: "event-tampered-validation-gates",
    data: {
      approval: {
        ...approvalSnapshot,
        requiredValidationGates: ["forged-gate"],
      },
    },
  };
  const outOfOrderDecision = {
    ...approvalEvent,
    id: "event-out-of-order-approval",
    sequence: approvalRequired.events.at(-1).sequence,
  };
  const duplicateDecision = {
    ...approvalEvent,
    id: "event-duplicate-approval",
    sequence: approvalEvent.sequence + 1,
  };

  assert.throws(
    () => replay([...approvalRequired.events, missingDecision]),
    /RELEASE_APPROVED requires approval/,
  );
  assert.throws(
    () => replay([...approvalRequired.events, staleDecision]),
    /exact current candidate and passing Evidence/,
  );
  assert.throws(
    () => replay([...approvalRequired.events, tamperedGateDeclaration]),
    /exact current candidate and passing Evidence/,
  );
  assert.throws(
    () =>
      replay([
        ...approvalRequired.events.slice(0, -1),
        outOfOrderDecision,
      ]),
    /RELEASE_APPROVED is not allowed while Mission is VALIDATING/,
  );
  assert.throws(
    () =>
      replay([
        ...approvalRequired.events,
        approvalEvent,
        duplicateDecision,
      ]),
    /RELEASE_APPROVED is not allowed while Mission is READY_TO_RELEASE/,
  );
});

test("material Context revision invalidates a recorded release approval", async () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createReleaseHarness(eventStore);
  const { created, execute, approvalRequired } =
    await createReleaseMissionAtApproval(orchestrator);
  const approved = execute(
    "APPROVE_RELEASE",
    { approval: { summary: "Approve candidate before Context changes" } },
    "Approve the current Context version",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );
  const revised = execute(
    "REVISE_CONTEXT",
    {
      context: sourceBackedContext("Material release Context v2"),
    },
    "Repository state changed after approval",
  );

  assert.deepEqual(
    {
      status: revised.status,
      contextPackVersion: revised.contextPackVersion,
      approval: revised.approval,
      releaseReadiness: revised.releaseReadiness,
      invalidatedArtifactRefs: revised.invalidatedArtifactRefs,
      invalidatedEvidenceRefs: revised.invalidatedEvidenceRefs,
      allowedActions: revised.allowedActions,
    },
    {
      status: "CONTEXT_READY",
      contextPackVersion: 2,
      approval: null,
      releaseReadiness: null,
      invalidatedArtifactRefs: ["artifact://release-candidate-1"],
      invalidatedEvidenceRefs: expectedReleaseReadiness([
        releaseArtifact("release-candidate-1", "artifact://release-candidate-1"),
      ]).evidenceRefs,
      allowedActions: [
        "accept_plan",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );

  const staleApproval = {
    ...approved.events.at(-1),
    id: "event-stale-after-context",
    sequence: revised.events.length + 1,
    contextPackVersion: revised.contextPackVersion,
  };
  const replay = createMissionOrchestrator({
    eventStore: createMemoryEventStore({
      [created.id]: [...revised.events, staleApproval],
    }),
  });
  assert.throws(
    () => replay.getMission(created.id),
    /RELEASE_APPROVED is not allowed while Mission is CONTEXT_READY/,
  );
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
        context: sourceBackedContext("Approved PRD and hybrid UI decision"),
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
      allowedActions: ["evaluate_playbook_candidate"],
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
    [
      "CAPTURE_CONTEXT",
      "context",
      sourceBackedContext("Versioned Context Pack"),
    ],
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

test("replay rejects a routed Assignment that omits required bounds", () => {
  const source = createHarness();
  const mission = source.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission before forging an incomplete Assignment",
  });
  advanceToPlanned(source, mission.id);
  const planned = source.getMission(mission.id);
  const incompleteAssignmentStore = createMemoryEventStore({
    [mission.id]: [
      ...planned.events,
      {
        id: "event-incomplete-assignment",
        missionId: mission.id,
        sequence: planned.events.length + 1,
        type: "ASSIGNMENT_ROUTED",
        actor: "mission-owner",
        occurredAt: "2026-07-30T08:00:00.000Z",
        reason: "Forge an Assignment without its bounds",
        contextPackVersion: 1,
        evidenceRefs: [],
        data: {
          assignment: {
            id: "assignment-incomplete",
            goal: "Pretend this Assignment is bounded",
            effectivePermission: "read-only",
            workKind: "deterministic",
            risk: "low",
          },
          agent: {
            roleId: "luna_worker",
            roleName: "Luna Worker",
            capability: "deterministic",
            effectivePermission: "read-only",
          },
        },
      },
    ],
  });

  assert.throws(
    () => createHarness(incompleteAssignmentStore).getMission(mission.id),
    /Assignment acceptanceCriteria must contain at least one item/,
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
    [
      "CAPTURE_CONTEXT",
      "context",
      sourceBackedContext("Bounded Context"),
    ],
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
        payload: {
          context: sourceBackedContext("Original writer Context"),
        },
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
    payload: { context: sourceBackedContext(summary) },
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

test("Mission Orchestrator routes one bounded Assignment and attaches completed Run output", async () => {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
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
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for a real bounded Assignment",
  });
  const planned = advanceToPlanned(orchestrator, mission.id);

  const completedRun = await orchestrator.dispatchAssignment(mission.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Route deterministic work to the smallest capable role",
  });

  assert.deepEqual(
    {
      missionStatus: completedRun.status,
      assignment: completedRun.assignment,
      agent: completedRun.agent,
      run: completedRun.run,
      artifacts: completedRun.artifacts,
      eventTypes: completedRun.events.map((event) => event.type),
      completionEvidenceRefs: completedRun.events.at(-1).evidenceRefs,
      allowedActions: completedRun.allowedActions,
    },
    {
      missionStatus: "IN_REVIEW",
      assignment: {
        ...boundedAssignment,
        contextSlice: planned.context,
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
        summary: "Returned the requested event inventory",
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
      artifacts: [
        {
          name: "event-inventory",
          uri: "artifact://event-inventory",
        },
      ],
      eventTypes: [
        "MISSION_CREATED",
        "CONTEXT_CAPTURED",
        "PLAN_ACCEPTED",
        "ASSIGNMENT_ROUTED",
        "AGENT_RUN_STARTED",
        "AGENT_RUN_UPDATED",
        "AGENT_RUN_COMPLETED",
      ],
      completionEvidenceRefs: ["evidence://event-inventory"],
      allowedActions: [
        "pass_review",
        "reject_review",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );
});

test("blocked Run preserves the blocker, attempted alternatives, and required authority", async () => {
  const eventStore = createMemoryEventStore();
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-blocked",
          occurredAt: "2026-07-30T09:00:00.000Z",
        };
        yield {
          kind: "blocked",
          runId: "run-blocked",
          occurredAt: "2026-07-30T09:01:00.000Z",
          blocker: "The requested source path is outside assigned ownership",
          attemptedAlternatives: [
            "Searched the allowed Context slice",
            "Confirmed the missing source is not referenced",
          ],
          requiredAuthorityOrInput:
            "Add the source path to readPaths or provide its contents",
        };
      },
    },
  });
  const orchestrator = createHarness(eventStore, agentRouter);
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission that may report a blocker",
  });
  advanceToPlanned(orchestrator, mission.id);

  const blocked = await orchestrator.dispatchAssignment(mission.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Dispatch within the declared ownership boundary",
  });
  const replayed = createHarness(eventStore).getMission(mission.id);

  assert.deepEqual(
    {
      missionStatus: blocked.status,
      run: blocked.run,
      allowedActions: blocked.allowedActions,
      lastEvent: blocked.events.at(-1).type,
      replayedRun: replayed.run,
    },
    {
      missionStatus: "RUNNING",
      run: {
        id: "run-blocked",
        status: "BLOCKED",
        startedAt: "2026-07-30T09:00:00.000Z",
        updatedAt: "2026-07-30T09:01:00.000Z",
        summary: null,
        modelMetadata: null,
        evidence: [],
        blocker: "The requested source path is outside assigned ownership",
        attemptedAlternatives: [
          "Searched the allowed Context slice",
          "Confirmed the missing source is not referenced",
        ],
        requiredAuthorityOrInput:
          "Add the source path to readPaths or provide its contents",
      },
      allowedActions: [
        "start_correction",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      lastEvent: "AGENT_RUN_BLOCKED",
      replayedRun: blocked.run,
    },
  );
});

test("transport failure is replayed as an honest Run error without inventing progress", async () => {
  const eventStore = createMemoryEventStore();
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        throw new Error("Codex agent transport is unavailable");
      },
    },
  });
  const orchestrator = createHarness(eventStore, agentRouter);
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission that records transport failure",
  });
  advanceToPlanned(orchestrator, mission.id);

  await assert.rejects(
    () =>
      orchestrator.dispatchAssignment(mission.id, {
        assignment: boundedAssignment,
        actor: "mission-owner",
        reason: "Attempt the bounded dispatch",
      }),
    /Codex agent transport is unavailable/,
  );

  const failed = createHarness(eventStore).getMission(mission.id);
  assert.deepEqual(
    {
      missionStatus: failed.status,
      assignmentId: failed.assignment.id,
      runtimeStatus: failed.run.status,
      error: failed.run.error,
      eventTypes: failed.events.map((event) => event.type),
      allowedActions: failed.allowedActions,
    },
    {
      missionStatus: "PLANNED",
      assignmentId: "assignment-001",
      runtimeStatus: "ERROR",
      error: "Codex agent transport is unavailable",
      eventTypes: [
        "MISSION_CREATED",
        "CONTEXT_CAPTURED",
        "PLAN_ACCEPTED",
        "ASSIGNMENT_ROUTED",
        "AGENT_RUN_ERROR",
      ],
      allowedActions: [
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );
});

test("Assignment permission cannot exceed the Mission mutation authority", async () => {
  let transportStarted = false;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        transportStarted = true;
      },
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const mission = orchestrator.createMission({
    brief: { ...validBrief, mutationAuthority: "read-only" },
    actor: "mission-owner",
    reason: "Create a read-only Mission",
  });
  advanceToPlanned(orchestrator, mission.id);

  await assert.rejects(
    () =>
      orchestrator.dispatchAssignment(mission.id, {
        assignment: {
          ...boundedAssignment,
          goal: "Modify the Mission UI",
          workKind: "implementation",
          risk: "medium",
          effectivePermission: "workspace-write",
          ownershipBoundary: {
            readPaths: ["codex-mission-control/src/main.js"],
            writePaths: ["codex-mission-control/src/main.js"],
          },
        },
        actor: "mission-owner",
        reason: "Attempt to expand a read-only Mission",
      }),
    /Assignment workspace-write permission exceeds Mission mutation authority/,
  );

  assert.deepEqual(
    {
      transportStarted,
      eventTypes: orchestrator
        .getMission(mission.id)
        .events.map((event) => event.type),
    },
    {
      transportStarted: false,
      eventTypes: ["MISSION_CREATED", "CONTEXT_CAPTURED", "PLAN_ACCEPTED"],
    },
  );
});

test("a second dispatch is rejected before it can append a duplicate Assignment", async () => {
  const eventStore = createMemoryEventStore();
  let releaseFirstRun;
  const firstRunCanComplete = new Promise((resolve) => {
    releaseFirstRun = resolve;
  });
  let transportCall = 0;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        transportCall += 1;
        const runId = `run-${transportCall}`;
        yield {
          kind: "started",
          runId,
          occurredAt: "2026-07-30T10:00:00.000Z",
        };
        await firstRunCanComplete;
        yield {
          kind: "blocked",
          runId,
          occurredAt: "2026-07-30T10:01:00.000Z",
          blocker: "Smoke run intentionally stopped",
          attemptedAlternatives: ["Confirmed duplicate dispatch protection"],
          requiredAuthorityOrInput: "No further input required",
        };
      },
    },
  });
  const orchestrator = createHarness(eventStore, agentRouter);
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for duplicate dispatch protection",
  });
  advanceToPlanned(orchestrator, mission.id);

  const firstDispatch = orchestrator.dispatchAssignment(mission.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Dispatch the one allowed Assignment",
  });
  const secondDispatch = orchestrator.dispatchAssignment(mission.id, {
    assignment: { ...boundedAssignment, id: "assignment-duplicate" },
    actor: "mission-owner",
    reason: "Attempt a duplicate Assignment",
  });
  await assert.rejects(
    secondDispatch,
    /Mission already has Assignment assignment-001/,
  );
  releaseFirstRun();
  await firstDispatch;

  const replayed = createHarness(eventStore).getMission(mission.id);
  assert.deepEqual(
    {
      assignmentEvents: replayed.events.filter(
        (event) => event.type === "ASSIGNMENT_ROUTED",
      ).length,
      assignmentId: replayed.assignment.id,
      runStatus: replayed.run.status,
    },
    {
      assignmentEvents: 1,
      assignmentId: "assignment-001",
      runStatus: "BLOCKED",
    },
  );
});

test("post-terminal transport output cannot append a second terminal Run event", async () => {
  const eventStore = createMemoryEventStore();
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-terminal",
          occurredAt: "2026-07-30T11:00:00.000Z",
        };
        for (const suffix of ["first", "duplicate"]) {
          yield {
            kind: "completed",
            runId: "run-terminal",
            occurredAt:
              suffix === "first"
                ? "2026-07-30T11:01:00.000Z"
                : "2026-07-30T11:02:00.000Z",
            summary: `${suffix} completion`,
            artifacts: [
              {
                name: `${suffix}-artifact`,
                uri: `artifact://${suffix}`,
              },
            ],
            evidence: [
              {
                ref: `evidence://${suffix}`,
                kind: "validation",
                summary: `${suffix} Evidence`,
              },
            ],
          };
        }
      },
    },
  });
  const orchestrator = createHarness(eventStore, agentRouter);
  const mission = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for terminal stream protection",
  });
  advanceToPlanned(orchestrator, mission.id);

  const completed = await orchestrator.dispatchAssignment(mission.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Dispatch a transport with duplicate terminal output",
  });
  const replayed = createHarness(eventStore).getMission(mission.id);

  assert.deepEqual(
    {
      status: completed.status,
      terminalEvents: replayed.events.filter(
        (event) => event.type === "AGENT_RUN_COMPLETED",
      ).length,
      artifactNames: replayed.artifacts.map((artifact) => artifact.name),
      evidenceRefs: replayed.run.evidence.map((evidence) => evidence.ref),
    },
    {
      status: "IN_REVIEW",
      terminalEvents: 1,
      artifactNames: ["first-artifact"],
      evidenceRefs: ["evidence://first"],
    },
  );
});

test("review rejection enters CHANGES_REQUESTED with distinct reason and Evidence", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission that needs an auditable correction loop",
  });
  const commands = [
    {
      type: "CAPTURE_CONTEXT",
      payload: {
        context: sourceBackedContext("Ticket 02 correction-loop Context"),
      },
      reason: "Capture correction-loop Context",
    },
    {
      type: "ACCEPT_PLAN",
      payload: { plan: { steps: ["build", "review", "correct"] } },
      reason: "Accept the correction-capable plan",
    },
    {
      type: "START_RUN",
      payload: { run: { agentRole: "terra_builder" } },
      reason: "Start the bounded implementation",
    },
    {
      type: "SUBMIT_ARTIFACT",
      payload: {
        artifact: {
          name: "candidate-v1",
          uri: "artifact://candidate-v1",
        },
      },
      reason: "Submit candidate v1",
      evidenceRefs: ["evidence://artifact-v1"],
    },
  ];
  for (const command of commands) {
    orchestrator.execute(created.id, {
      ...command,
      actor: "mission-owner",
    });
  }

  const rejected = orchestrator.execute(created.id, {
    type: "REJECT_REVIEW",
    payload: {
      review: {
        outcome: "PASSED",
        summary: "Unsafe retry behavior",
        findings: ["Retry can append the same event twice"],
      },
    },
    actor: "sol-reviewer",
    reason: "Review found an idempotency defect",
    evidenceRefs: ["evidence://review-failure-v1"],
  });

  assert.deepEqual(
    {
      status: rejected.status,
      review: rejected.review,
      changeRequest: rejected.changeRequest,
      allowedActions: rejected.allowedActions,
      latestEvent: rejected.events.at(-1),
    },
    {
      status: "CHANGES_REQUESTED",
      review: {
        outcome: "FAILED",
        summary: "Unsafe retry behavior",
        findings: ["Retry can append the same event twice"],
      },
      changeRequest: {
        source: "REVIEW",
        reason: "Review found an idempotency defect",
        evidenceRefs: ["evidence://review-failure-v1"],
        requestedAtSequence: 6,
      },
      allowedActions: [
        "start_correction",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEvent: {
        schemaVersion: 3,
        id: "event-6",
        missionId: "mission-001",
        sequence: 6,
        type: "REVIEW_REJECTED",
        actor: "sol-reviewer",
        occurredAt: "2026-07-28T08:00:00.000Z",
        reason: "Review found an idempotency defect",
        contextPackVersion: 1,
        evidenceRefs: ["evidence://review-failure-v1"],
        data: {
          review: {
            outcome: "PASSED",
            summary: "Unsafe retry behavior",
            findings: ["Retry can append the same event twice"],
          },
        },
      },
    },
  );
});

test("validation failure enters CHANGES_REQUESTED without erasing its gate provenance", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission that may fail validation",
  });
  const commands = [
    {
      type: "CAPTURE_CONTEXT",
      payload: {
        context: sourceBackedContext("Validation failure Context"),
      },
      reason: "Capture Context",
    },
    {
      type: "ACCEPT_PLAN",
      payload: { plan: { steps: ["build", "review", "validate"] } },
      reason: "Accept plan",
    },
    {
      type: "START_RUN",
      payload: { run: { agentRole: "terra_builder" } },
      reason: "Start implementation",
    },
    {
      type: "SUBMIT_ARTIFACT",
      payload: {
        artifact: {
          name: "candidate-v1",
          uri: "artifact://candidate-v1",
        },
      },
      reason: "Submit candidate v1",
      evidenceRefs: ["evidence://artifact-v1"],
    },
    {
      type: "PASS_REVIEW",
      payload: { review: { summary: "Review passed for candidate v1" } },
      reason: "Independent review passed",
      evidenceRefs: ["evidence://review-pass-v1"],
    },
  ];
  for (const command of commands) {
    orchestrator.execute(created.id, {
      ...command,
      actor: "mission-owner",
    });
  }

  const failed = orchestrator.execute(created.id, {
    type: "FAIL_VALIDATION",
    payload: {
      validation: {
        summary: "Replay acceptance failed",
        failures: ["Reload lost the correction reason"],
      },
    },
    actor: "validator",
    reason: "Validation found a replay regression",
    evidenceRefs: ["evidence://validation-failure-v1"],
  });

  assert.deepEqual(
    {
      status: failed.status,
      review: failed.review,
      validation: failed.validation,
      changeRequest: failed.changeRequest,
      latestEventType: failed.events.at(-1).type,
      allowedActions: failed.allowedActions,
    },
    {
      status: "CHANGES_REQUESTED",
      review: { summary: "Review passed for candidate v1" },
      validation: {
        outcome: "FAILED",
        summary: "Replay acceptance failed",
        failures: ["Reload lost the correction reason"],
      },
      changeRequest: {
        source: "VALIDATION",
        reason: "Validation found a replay regression",
        evidenceRefs: ["evidence://validation-failure-v1"],
        requestedAtSequence: 7,
      },
      latestEventType: "VALIDATION_FAILED",
      allowedActions: [
        "start_correction",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );
});

test("repeated correction loops require regenerated Artifact and Evidence references", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with repeated correction loops",
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
    { context: sourceBackedContext("Repeated correction Context") },
    "Capture Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "validate", "correct"] } },
    "Accept correction-capable plan",
  );
  execute(
    "START_RUN",
    { run: { id: "run-v1", agentRole: "terra_builder" } },
    "Start candidate v1",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v1", uri: "artifact://candidate-v1" } },
    "Submit candidate v1",
    ["evidence://artifact-v1"],
  );
  execute(
    "REJECT_REVIEW",
    { review: { summary: "Candidate v1 needs idempotency fixes" } },
    "Review rejected candidate v1",
    ["evidence://review-failure-v1"],
  );
  execute(
    "START_CORRECTION",
    { run: { id: "run-v2", agentRole: "terra_builder" } },
    "Return requested changes to the assigned agent",
  );

  const eventCountBeforeStaleArtifact = orchestrator.getMission(
    created.id,
  ).events.length;
  assert.throws(
    () =>
      execute(
        "SUBMIT_ARTIFACT",
        {
          artifact: {
            name: "candidate-v1-relabelled",
            uri: "artifact://candidate-v1",
          },
        },
        "Attempt to reuse candidate v1",
        ["evidence://artifact-v1"],
      ),
    /SUBMIT_ARTIFACT requires a regenerated Artifact reference/,
  );
  assert.equal(
    orchestrator.getMission(created.id).events.length,
    eventCountBeforeStaleArtifact,
  );

  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v2", uri: "artifact://candidate-v2" } },
    "Submit corrected candidate v2",
    ["evidence://artifact-v2"],
  );
  assert.throws(
    () =>
      execute(
        "PASS_REVIEW",
        { review: { summary: "Attempt stale review proof" } },
        "Attempt to reuse failed review Evidence",
        ["evidence://review-failure-v1"],
      ),
    /PASS_REVIEW requires current Evidence/,
  );
  execute(
    "PASS_REVIEW",
    { review: { summary: "Candidate v2 passed review" } },
    "Review candidate v2",
    ["evidence://review-pass-v2"],
  );
  execute(
    "FAIL_VALIDATION",
    { validation: { summary: "Candidate v2 fails reload acceptance" } },
    "Validation rejected candidate v2",
    ["evidence://validation-failure-v2"],
  );
  execute(
    "START_CORRECTION",
    { run: { id: "run-v3", agentRole: "terra_builder" } },
    "Return validation failure to the assigned agent",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v3", uri: "artifact://candidate-v3" } },
    "Submit corrected candidate v3",
    ["evidence://artifact-v3"],
  );
  execute(
    "PASS_REVIEW",
    { review: { summary: "Candidate v3 passed review" } },
    "Review candidate v3",
    ["evidence://review-pass-v3"],
  );
  const recovered = execute(
    "PASS_VALIDATION",
    { validation: { summary: "Candidate v3 passed reload acceptance" } },
    "Validate candidate v3",
    ["evidence://validation-pass-v3"],
  );

  assert.deepEqual(
    {
      status: recovered.status,
      artifact: recovered.artifact,
      artifactEvidenceRefs: recovered.artifactEvidenceRefs,
      review: recovered.review,
      reviewEvidenceRefs: recovered.reviewEvidenceRefs,
      validation: recovered.validation,
      validationEvidenceRefs: recovered.validationEvidenceRefs,
      invalidatedArtifactRefs: recovered.invalidatedArtifactRefs,
      invalidatedEvidenceRefs: recovered.invalidatedEvidenceRefs,
      correctionEvents: recovered.events
        .filter((event) =>
          [
            "REVIEW_REJECTED",
            "VALIDATION_FAILED",
            "CORRECTION_STARTED",
          ].includes(event.type),
        )
        .map((event) => event.type),
    },
    {
      status: "LEARNING",
      artifact: {
        name: "candidate-v3",
        uri: "artifact://candidate-v3",
      },
      artifactEvidenceRefs: ["evidence://artifact-v3"],
      review: { summary: "Candidate v3 passed review" },
      reviewEvidenceRefs: ["evidence://review-pass-v3"],
      validation: { summary: "Candidate v3 passed reload acceptance" },
      validationEvidenceRefs: ["evidence://validation-pass-v3"],
      invalidatedArtifactRefs: [
        "artifact://candidate-v1",
        "artifact://candidate-v2",
      ],
      invalidatedEvidenceRefs: [
        "evidence://artifact-v1",
        "evidence://review-failure-v1",
        "evidence://artifact-v2",
        "evidence://review-pass-v2",
        "evidence://validation-failure-v2",
      ],
      correctionEvents: [
        "REVIEW_REJECTED",
        "CORRECTION_STARTED",
        "VALIDATION_FAILED",
        "CORRECTION_STARTED",
      ],
    },
  );
});

test("material Context revision increments its version and invalidates downstream gate Evidence", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission whose Context may materially change",
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
    {
      context: sourceBackedContext("Context v1"),
    },
    "Capture Context v1",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "validate"] } },
    "Accept plan v1",
  );
  execute(
    "START_RUN",
    { run: { id: "run-v1", agentRole: "terra_builder" } },
    "Start candidate v1",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v1", uri: "artifact://candidate-v1" } },
    "Submit candidate v1",
    ["evidence://artifact-v1"],
  );
  execute(
    "PASS_REVIEW",
    { review: { summary: "Candidate v1 passed review" } },
    "Review candidate v1",
    ["evidence://review-v1"],
  );
  execute(
    "PASS_VALIDATION",
    { validation: { summary: "Candidate v1 passed validation" } },
    "Validate candidate v1",
    ["evidence://validation-v1"],
  );

  const revised = execute(
    "REVISE_CONTEXT",
    {
      context: sourceBackedContext(
        "Context v2 includes a material event-store constraint",
      ),
    },
    "Material repository change requires a new Context Pack",
  );

  assert.deepEqual(
    {
      status: revised.status,
      contextPackVersion: revised.contextPackVersion,
      context: revised.context,
      plan: revised.plan,
      run: revised.run,
      artifact: revised.artifact,
      review: revised.review,
      validation: revised.validation,
      approval: revised.approval,
      invalidatedArtifactRefs: revised.invalidatedArtifactRefs,
      invalidatedEvidenceRefs: revised.invalidatedEvidenceRefs,
      allowedActions: revised.allowedActions,
      latestEvent: revised.events.at(-1),
    },
    {
      status: "CONTEXT_READY",
      contextPackVersion: 2,
      context: projectedSourceBackedContext(
        "Context v2 includes a material event-store constraint",
        2,
      ),
      plan: null,
      run: null,
      artifact: null,
      review: null,
      validation: null,
      approval: null,
      invalidatedArtifactRefs: ["artifact://candidate-v1"],
      invalidatedEvidenceRefs: [
        "evidence://artifact-v1",
        "evidence://review-v1",
        "evidence://validation-v1",
      ],
      allowedActions: [
        "accept_plan",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEvent: {
        schemaVersion: 3,
        id: "event-8",
        missionId: "mission-001",
        sequence: 8,
        type: "CONTEXT_REVISED",
        actor: "mission-owner",
        occurredAt: "2026-07-28T08:00:00.000Z",
        reason: "Material repository change requires a new Context Pack",
        contextPackVersion: 2,
        evidenceRefs: [],
        data: {
          context: projectedSourceBackedContext(
            "Context v2 includes a material event-store constraint",
            2,
          ),
        },
      },
    },
  );

  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["rebuild", "review", "validate"] } },
    "Accept plan v2",
  );
  execute(
    "START_RUN",
    { run: { id: "run-v2", agentRole: "terra_builder" } },
    "Start candidate v2",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v2", uri: "artifact://candidate-v2" } },
    "Submit candidate v2",
    ["evidence://artifact-v2"],
  );
  assert.throws(
    () =>
      execute(
        "PASS_REVIEW",
        { review: { summary: "Attempt to reuse review v1" } },
        "Attempt stale review after Context revision",
        ["evidence://review-v1"],
      ),
    /PASS_REVIEW requires current Evidence/,
  );
  assert.equal(orchestrator.getMission(created.id).contextPackVersion, 2);
});

test("blocked Mission records its prior safe state and resumes without skipping the active gate", () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission that may need deliberate recovery",
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
    { context: sourceBackedContext("Block and resume Context") },
    "Capture Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "validate"] } },
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
  execute(
    "PASS_REVIEW",
    { review: { summary: "Candidate passed review" } },
    "Pass review",
    ["evidence://review"],
  );

  const blocked = execute(
    "BLOCK_MISSION",
    {
      block: {
        blocker: "Validation environment is unavailable",
        attemptedAlternatives: [
          "Retried the local runner",
          "Checked the documented fallback",
        ],
        requiredAuthorityOrInput: "Restore the validation runner",
      },
    },
    "Pause at the validation gate until the runner is restored",
  );

  assert.deepEqual(
    {
      status: blocked.status,
      blockedFrom: blocked.blockedFrom,
      block: blocked.block,
      allowedActions: blocked.allowedActions,
      latestEventType: blocked.events.at(-1).type,
    },
    {
      status: "BLOCKED",
      blockedFrom: "VALIDATING",
      block: {
        blocker: "Validation environment is unavailable",
        attemptedAlternatives: [
          "Retried the local runner",
          "Checked the documented fallback",
        ],
        requiredAuthorityOrInput: "Restore the validation runner",
        reason: "Pause at the validation gate until the runner is restored",
        blockedAtSequence: 7,
      },
      allowedActions: ["resume_mission", "cancel_mission"],
      latestEventType: "MISSION_BLOCKED",
    },
  );
  assert.throws(
    () =>
      execute(
        "PASS_VALIDATION",
        { validation: { summary: "Attempt gate bypass" } },
        "Attempt to validate while blocked",
        ["evidence://invalid"],
      ),
    /PASS_VALIDATION is not allowed while Mission is BLOCKED/,
  );

  const resumed = execute(
    "RESUME_MISSION",
    {
      resumption: {
        summary: "Validation runner restored",
        targetStatus: "LEARNING",
      },
    },
    "Resume at the recorded safe state",
  );
  assert.deepEqual(
    {
      status: resumed.status,
      blockedFrom: resumed.blockedFrom,
      block: resumed.block,
      lastBlock: resumed.lastBlock,
      resume: resumed.resume,
      allowedActions: resumed.allowedActions,
    },
    {
      status: "VALIDATING",
      blockedFrom: null,
      block: null,
      lastBlock: blocked.block,
      resume: {
        fromStatus: "BLOCKED",
        toStatus: "VALIDATING",
        reason: "Resume at the recorded safe state",
        summary: "Validation runner restored",
        resumedAtSequence: 8,
      },
      allowedActions: [
        "pass_validation",
        "fail_validation",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );

  const replayed = createHarness(eventStore).getMission(created.id);
  assert.equal(replayed.status, "VALIDATING");
  const validated = execute(
    "PASS_VALIDATION",
    { validation: { summary: "Validation passed after recovery" } },
    "Pass the gate after resuming",
    ["evidence://validation"],
  );
  assert.equal(validated.status, "LEARNING");
});

test("cancelled Mission is terminal while its complete event history remains replayable", () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission the owner may cancel",
  });
  const execute = (type, payload, reason) =>
    orchestrator.execute(created.id, {
      type,
      payload,
      actor: "mission-owner",
      reason,
    });

  execute(
    "CAPTURE_CONTEXT",
    { context: sourceBackedContext("Cancellation Context") },
    "Capture Context",
  );
  execute(
    "BLOCK_MISSION",
    {
      block: {
        blocker: "Required product decision is unavailable",
        attemptedAlternatives: ["Reviewed the existing Brief"],
        requiredAuthorityOrInput: "Mission owner decision",
      },
    },
    "Pause until the owner decides whether to continue",
  );
  const cancelled = execute(
    "CANCEL_MISSION",
    {
      cancellation: {
        summary: "The outcome is no longer needed",
      },
    },
    "Mission owner withdrew the Mission",
  );

  assert.deepEqual(
    {
      status: cancelled.status,
      cancelledFrom: cancelled.cancelledFrom,
      cancellation: cancelled.cancellation,
      retainedBlocker: cancelled.block.blocker,
      allowedActions: cancelled.allowedActions,
      eventTypes: cancelled.events.map((event) => event.type),
    },
    {
      status: "CANCELLED",
      cancelledFrom: "BLOCKED",
      cancellation: {
        summary: "The outcome is no longer needed",
        reason: "Mission owner withdrew the Mission",
        cancelledAtSequence: 4,
      },
      retainedBlocker: "Required product decision is unavailable",
      allowedActions: [],
      eventTypes: [
        "MISSION_CREATED",
        "CONTEXT_CAPTURED",
        "MISSION_BLOCKED",
        "MISSION_CANCELLED",
      ],
    },
  );

  const eventCount = cancelled.events.length;
  assert.throws(
    () =>
      execute(
        "RESUME_MISSION",
        { resumption: { summary: "Attempt to reopen cancellation" } },
        "Attempt to resume a terminal Mission",
      ),
    /RESUME_MISSION is not allowed while Mission is CANCELLED/,
  );
  assert.equal(orchestrator.getMission(created.id).events.length, eventCount);

  const replayed = createHarness(eventStore).getMission(created.id);
  assert.deepEqual(
    {
      status: replayed.status,
      cancellation: replayed.cancellation,
      eventCount: replayed.events.length,
    },
    {
      status: "CANCELLED",
      cancellation: cancelled.cancellation,
      eventCount,
    },
  );
});

test("malformed control command fails before appending an unreplayable event", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for fail-closed control validation",
  });
  orchestrator.execute(created.id, {
    type: "BLOCK_MISSION",
    payload: {
      block: {
        blocker: "Awaiting bounded input",
        attemptedAlternatives: ["Checked the current Context"],
        requiredAuthorityOrInput: "Mission owner input",
      },
    },
    actor: "mission-owner",
    reason: "Block before the required input arrives",
  });
  const eventCount = orchestrator.getMission(created.id).events.length;

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "RESUME_MISSION",
        payload: { resumption: {} },
        actor: "mission-owner",
        reason: "Attempt an ambiguous resume",
      }),
    /RESUME_MISSION requires a resumption summary/,
  );
  assert.equal(orchestrator.getMission(created.id).events.length, eventCount);
});

test("control transition racing an agent observation leaves replayable history", async () => {
  const eventStore = createMemoryEventStore();
  let signalRunStarted;
  let releaseProgress;
  const runStarted = new Promise((resolve) => {
    signalRunStarted = resolve;
  });
  const continueRun = new Promise((resolve) => {
    releaseProgress = resolve;
  });
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-race",
          occurredAt: "2026-07-30T11:00:00.000Z",
        };
        signalRunStarted();
        await continueRun;
        yield {
          kind: "progress",
          runId: "run-race",
          occurredAt: "2026-07-30T11:01:00.000Z",
          summary: "Late progress after owner control",
        };
      },
    },
  });
  const worker = createHarness(eventStore, agentRouter);
  let controllerEventNumber = 100;
  const controller = createMissionOrchestrator({
    eventStore,
    clock: () => "2026-07-30T11:00:30.000Z",
    createId: (kind) =>
      kind === "mission"
        ? "unused-controller-mission"
        : `event-${++controllerEventNumber}`,
  });
  const created = worker.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for an agent/control race",
  });
  advanceToPlanned(worker, created.id);

  const dispatch = worker.dispatchAssignment(created.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Route the bounded Assignment",
  });
  await runStarted;
  const cancelled = controller.execute(created.id, {
    type: "CANCEL_MISSION",
    payload: {
      cancellation: { summary: "Owner stopped the in-flight Mission" },
    },
    actor: "mission-owner",
    reason: "Cancel while the agent transport is still reporting",
  });
  releaseProgress();

  await assert.rejects(dispatch, /Mission is CANCELLED/);
  const replayed = controller.getMission(created.id);
  assert.deepEqual(
    {
      status: replayed.status,
      latestEventType: replayed.events.at(-1).type,
      eventCount: replayed.events.length,
      cancellation: replayed.cancellation,
    },
    {
      status: "CANCELLED",
      latestEventType: "MISSION_CANCELLED",
      eventCount: cancelled.events.length,
      cancellation: cancelled.cancellation,
    },
  );
});

test("correction Run returns live-agent work to the originally assigned role", async () => {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-original",
          occurredAt: "2026-07-30T12:00:00.000Z",
        };
        yield {
          kind: "completed",
          runId: "run-original",
          occurredAt: "2026-07-30T12:01:00.000Z",
          summary: "Submitted the original candidate",
          artifacts: [
            {
              name: "event-inventory-v1",
              uri: "artifact://event-inventory-v1",
            },
          ],
          evidence: [
            {
              ref: "evidence://event-inventory-v1",
              kind: "inspection",
              summary: "Original bounded output",
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with an assigned live role",
  });
  advanceToPlanned(orchestrator, created.id);
  await orchestrator.dispatchAssignment(created.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Route the original Assignment",
  });
  orchestrator.execute(created.id, {
    type: "REJECT_REVIEW",
    payload: { review: { summary: "Correct the event ordering" } },
    actor: "sol-reviewer",
    reason: "Review requested a correction",
    evidenceRefs: ["evidence://review-failure"],
  });
  const eventCount = orchestrator.getMission(created.id).events.length;

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "START_CORRECTION",
        payload: {
          run: { id: "run-correction", agentRole: "terra_builder" },
        },
        actor: "mission-owner",
        reason: "Attempt to hand correction to a different role",
      }),
    /START_CORRECTION must return work to assigned role luna_worker/,
  );
  assert.equal(orchestrator.getMission(created.id).events.length, eventCount);

  const corrected = orchestrator.execute(created.id, {
    type: "START_CORRECTION",
    payload: {
      run: { id: "run-correction", agentRole: "luna_worker" },
    },
    actor: "mission-owner",
    reason: "Return correction to the assigned role",
  });
  assert.deepEqual(
    {
      status: corrected.status,
      assignedRole: corrected.agent.roleId,
      correctionRole: corrected.run.agentRole,
      allowedActions: corrected.allowedActions,
    },
    {
      status: "RUNNING",
      assignedRole: "luna_worker",
      correctionRole: "luna_worker",
      allowedActions: [
        "submit_artifact",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );
});

test("replay rejects stale Evidence reused after a correction request", () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for stale Evidence replay validation",
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
    { context: sourceBackedContext("Stale Evidence replay Context") },
    "Capture Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "correct"] } },
    "Accept plan",
  );
  execute(
    "START_RUN",
    { run: { id: "run-v1", agentRole: "terra_builder" } },
    "Start candidate v1",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v1", uri: "artifact://candidate-v1" } },
    "Submit candidate v1",
    ["evidence://artifact-v1"],
  );
  execute(
    "REJECT_REVIEW",
    { review: { summary: "Candidate v1 needs correction" } },
    "Reject candidate v1",
    ["evidence://review-failure-v1"],
  );
  const correctionStarted = execute(
    "START_CORRECTION",
    { run: { id: "run-v2", agentRole: "terra_builder" } },
    "Start candidate v2",
  );
  const forgedArtifact = {
    id: "event-forged-stale-artifact",
    missionId: created.id,
    sequence: correctionStarted.events.length + 1,
    type: "ARTIFACT_SUBMITTED",
    actor: "malformed-history",
    occurredAt: "2026-07-30T12:59:00.000Z",
    reason: "Attempt to reuse invalidated Artifact with fresh Evidence",
    contextPackVersion: correctionStarted.contextPackVersion,
    evidenceRefs: ["evidence://artifact-forged-fresh"],
    data: {
      artifact: {
        name: "candidate-v1-forged",
        uri: "artifact://candidate-v1",
      },
    },
  };
  const staleArtifactReplay = createMissionOrchestrator({
    eventStore: createMemoryEventStore({
      [created.id]: [...correctionStarted.events, forgedArtifact],
    }),
  });
  assert.throws(
    () => staleArtifactReplay.getMission(created.id),
    /ARTIFACT_SUBMITTED requires a regenerated Artifact reference/,
  );
  const corrected = execute(
    "SUBMIT_ARTIFACT",
    { artifact: { name: "candidate-v2", uri: "artifact://candidate-v2" } },
    "Submit candidate v2",
    ["evidence://artifact-v2"],
  );
  const forgedReview = {
    id: "event-forged-stale-review",
    missionId: created.id,
    sequence: corrected.events.length + 1,
    type: "REVIEW_PASSED",
    actor: "malformed-history",
    occurredAt: "2026-07-30T13:00:00.000Z",
    reason: "Attempt to reuse invalidated review Evidence",
    contextPackVersion: corrected.contextPackVersion,
    evidenceRefs: ["evidence://review-failure-v1"],
    data: { review: { summary: "Forged stale review pass" } },
  };
  const replay = createMissionOrchestrator({
    eventStore: createMemoryEventStore({
      [created.id]: [...corrected.events, forgedReview],
    }),
  });

  assert.throws(
    () => replay.getMission(created.id),
    /REVIEW_PASSED requires current Evidence/,
  );
});

test("blocking an in-flight assigned Run resumes with an explicit recovery action", async () => {
  const eventStore = createMemoryEventStore();
  let signalRunStarted;
  let releaseLateProgress;
  const runStarted = new Promise((resolve) => {
    signalRunStarted = resolve;
  });
  const continueRun = new Promise((resolve) => {
    releaseLateProgress = resolve;
  });
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-to-block",
          occurredAt: "2026-07-30T14:00:00.000Z",
        };
        signalRunStarted();
        await continueRun;
        yield {
          kind: "progress",
          runId: "run-to-block",
          occurredAt: "2026-07-30T14:01:00.000Z",
          summary: "Transport progress after the owner blocked work",
        };
      },
    },
  });
  const worker = createHarness(eventStore, agentRouter);
  let controlEventNumber = 200;
  const controller = createMissionOrchestrator({
    eventStore,
    clock: () => "2026-07-30T14:00:30.000Z",
    createId: (kind) =>
      kind === "mission"
        ? "unused-controller-mission"
        : `event-${++controlEventNumber}`,
  });
  const created = worker.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with an in-flight assigned Run",
  });
  advanceToPlanned(worker, created.id);
  const dispatch = worker.dispatchAssignment(created.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Route the bounded Assignment",
  });
  await runStarted;

  const blocked = controller.execute(created.id, {
    type: "BLOCK_MISSION",
    payload: {
      block: {
        blocker: "Owner input is required before the Run may continue",
        attemptedAlternatives: ["Preserved the active gate"],
        requiredAuthorityOrInput: "Mission owner input",
      },
    },
    actor: "mission-owner",
    reason: "Block the in-flight Run at its current safe state",
  });
  assert.equal(blocked.run.status, "INTERRUPTED");
  releaseLateProgress();
  await assert.rejects(dispatch, /Mission is BLOCKED/);

  const resumed = controller.execute(created.id, {
    type: "RESUME_MISSION",
    payload: { resumption: { summary: "Owner input supplied" } },
    actor: "mission-owner",
    reason: "Resume the interrupted Run",
  });
  assert.deepEqual(
    {
      status: resumed.status,
      runStatus: resumed.run.status,
      allowedActions: resumed.allowedActions,
      latestEventType: resumed.events.at(-1).type,
    },
    {
      status: "RUNNING",
      runStatus: "INTERRUPTED",
      allowedActions: [
        "start_correction",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEventType: "MISSION_RESUMED",
    },
  );
});

test("connected correction dispatches the regenerated candidate to the assigned agent transport", async () => {
  const requests = [];
  let runNumber = 0;
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        requests.push(request);
        runNumber += 1;
        const companionNumber = runNumber === 3 ? 2 : runNumber;
        const evidenceNumber = runNumber === 4 ? 2 : runNumber;
        yield {
          kind: "started",
          runId: `run-${runNumber}`,
          occurredAt: `2026-07-30T15:0${runNumber}:00.000Z`,
        };
        yield {
          kind: "completed",
          runId: `run-${runNumber}`,
          occurredAt: `2026-07-30T15:0${runNumber}:30.000Z`,
          summary: `Submitted candidate v${runNumber}`,
          artifacts: [
            {
              name: `candidate-v${runNumber}`,
              uri: `artifact://candidate-v${runNumber}`,
            },
            {
              name: `companion-v${companionNumber}`,
              uri: `artifact://companion-v${companionNumber}`,
            },
          ],
          evidence: [
            {
              ref: `evidence://candidate-v${evidenceNumber}`,
              kind: "inspection",
              summary: `Evidence for candidate v${evidenceNumber}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with connected correction transport",
  });
  advanceToPlanned(orchestrator, created.id);
  await orchestrator.dispatchAssignment(created.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Route candidate v1",
  });
  orchestrator.execute(created.id, {
    type: "REJECT_REVIEW",
    payload: { review: { summary: "Candidate v1 needs correction" } },
    actor: "sol-reviewer",
    reason: "Review requested candidate v2",
    evidenceRefs: ["evidence://review-failure-v1"],
  });

  const corrected = await orchestrator.dispatchCorrection(created.id, {
    actor: "mission-owner",
    reason: "Dispatch requested changes to the assigned role",
  });

  assert.deepEqual(
    {
      transportRoles: requests.map((request) => request.roleId),
      transportAssignments: requests.map(
        (request) => request.assignment.id,
      ),
      status: corrected.status,
      runId: corrected.run.id,
      artifact: corrected.artifact,
      artifactEvidenceRefs: corrected.artifactEvidenceRefs,
      tailEventTypes: corrected.events
        .slice(-3)
        .map((event) => event.type),
    },
    {
      transportRoles: ["luna_worker", "luna_worker"],
      transportAssignments: ["assignment-001", "assignment-001"],
      status: "IN_REVIEW",
      runId: "run-2",
      artifact: {
        name: "candidate-v2",
        uri: "artifact://candidate-v2",
      },
      artifactEvidenceRefs: ["evidence://candidate-v2"],
      tailEventTypes: [
        "CORRECTION_DISPATCHED",
        "AGENT_RUN_STARTED",
        "AGENT_RUN_COMPLETED",
      ],
    },
  );

  orchestrator.execute(created.id, {
    type: "REJECT_REVIEW",
    payload: { review: { summary: "Candidate v2 needs correction" } },
    actor: "sol-reviewer",
    reason: "Review requested candidate v3",
    evidenceRefs: ["evidence://review-failure-v2"],
  });
  await assert.rejects(
    orchestrator.dispatchCorrection(created.id, {
      actor: "mission-owner",
      reason: "Reject a correction that reuses a stale companion Artifact",
    }),
    /completed Run requires regenerated Artifact references/,
  );
  await assert.rejects(
    orchestrator.dispatchCorrection(created.id, {
      actor: "mission-owner",
      reason: "Reject a correction that reuses stale connected Evidence",
    }),
    /completed Run requires current Evidence/,
  );
  const rejectedStaleOutput = orchestrator.getMission(created.id);
  assert.deepEqual(
    {
      status: rejectedStaleOutput.status,
      runStatus: rejectedStaleOutput.run.status,
      artifact: rejectedStaleOutput.artifact,
      staleCompletionPersisted: rejectedStaleOutput.events.some(
        (event) =>
          event.type === "AGENT_RUN_COMPLETED" &&
          event.sequence > corrected.events.at(-1).sequence,
      ),
    },
    {
      status: "RUNNING",
      runStatus: "ERROR",
      artifact: null,
      staleCompletionPersisted: false,
    },
  );
});

test("planned Task Graph exposes dependencies and its unblocked Assignment frontier", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with dependency-aware work",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Context for a multi-agent Mission"),
    },
    actor: "mission-owner",
    reason: "Capture the Ticket 05 Context",
  });

  const task = (id, goal, overrides = {}) => ({
    ...boundedAssignment,
    id,
    goal,
    dependsOn: [],
    ...overrides,
  });
  const planned = orchestrator.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        steps: ["inspect", "build", "review"],
        taskGraph: {
          capacity: 4,
          coordinationRequired: true,
          assignments: [
            task("inspect-events", "Inspect the current event model"),
            task("inventory-ui", "Inventory the Mission Detail UI"),
            task("build-waves", "Build safe execution waves", {
              dependsOn: ["inspect-events", "inventory-ui"],
              workKind: "implementation",
              effectivePermission: "workspace-write",
              ownershipBoundary: {
                readPaths: ["codex-mission-control/src"],
                writePaths: ["codex-mission-control/src"],
              },
            }),
            task("review-waves", "Review the execution-wave candidate", {
              dependsOn: ["build-waves"],
              workKind: "review",
              risk: "high",
            }),
          ],
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept a dependency-aware execution plan",
  });

  assert.deepEqual(
    {
      capacity: planned.execution.capacity,
      reservedSlots: planned.execution.reservedSlots,
      workerCapacity: planned.execution.workerCapacity,
      frontier: planned.execution.frontier,
      nodes: planned.execution.nodes.map((node) => ({
        id: node.assignment.id,
        dependsOn: node.dependsOn,
        status: node.status,
      })),
      allowedActions: planned.allowedActions,
    },
    {
      capacity: 4,
      reservedSlots: 1,
      workerCapacity: 3,
      frontier: ["inspect-events", "inventory-ui"],
      nodes: [
        { id: "inspect-events", dependsOn: [], status: "PENDING" },
        { id: "inventory-ui", dependsOn: [], status: "PENDING" },
        {
          id: "build-waves",
          dependsOn: ["inspect-events", "inventory-ui"],
          status: "PENDING",
        },
        {
          id: "review-waves",
          dependsOn: ["build-waves"],
          status: "PENDING",
        },
      ],
      allowedActions: [
        "dispatch_execution_wave",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
    },
  );
});

test("Task Graph rejects a dependency cycle before appending the Plan", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for cycle validation",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Cycle validation Context"),
    },
    actor: "mission-owner",
    reason: "Capture Context before planning",
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
                { ...boundedAssignment, id: "task-a", dependsOn: ["task-b"] },
                { ...boundedAssignment, id: "task-b", dependsOn: ["task-a"] },
              ],
            },
          },
        },
        actor: "mission-owner",
        reason: "Attempt to accept a cyclic Task Graph",
      }),
    /Task Graph contains a dependency cycle/,
  );
  assert.equal(orchestrator.getMission(created.id).status, "CONTEXT_READY");
  assert.equal(orchestrator.getMission(created.id).events.length, 2);
});

test("execution wave reserves Orchestrator capacity and serializes overlapping writable ownership", async () => {
  const transportRequests = [];
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        transportRequests.push(request);
        const assignmentId = request.assignment.id;
        yield {
          kind: "started",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T09:00:00.000Z",
          model: { name: "observable-model", reasoningEffort: "medium" },
        };
        yield {
          kind: "completed",
          runId: `run:${assignmentId}`,
          occurredAt: "2026-08-08T09:01:00.000Z",
          summary: `Completed ${assignmentId}`,
          artifacts: [
            {
              name: `${assignmentId}-artifact`,
              uri: `artifact://${assignmentId}`,
            },
          ],
          evidence: [
            {
              ref: `evidence://${assignmentId}`,
              kind: "test",
              summary: `Observed completion for ${assignmentId}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for safe wave execution",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Safe-wave Context"),
    },
    actor: "mission-owner",
    reason: "Capture safe-wave Context",
  });
  const task = (id, ownershipBoundary, overrides = {}) => ({
    ...boundedAssignment,
    id,
    goal: `Complete ${id}`,
    dependsOn: [],
    ownershipBoundary,
    effectivePermission:
      ownershipBoundary.writePaths.length > 0 ? "workspace-write" : "read-only",
    workKind:
      ownershipBoundary.writePaths.length > 0 ? "implementation" : "deterministic",
    ...overrides,
  });
  orchestrator.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        taskGraph: {
          capacity: 4,
          coordinationRequired: true,
          assignments: [
            task("write-shared", {
              readPaths: ["codex-mission-control/src"],
              writePaths: ["codex-mission-control/src/shared"],
            }),
            task("write-shared-child", {
              readPaths: ["codex-mission-control/src"],
              writePaths: ["codex-mission-control/src/shared/feature.js"],
            }),
            task("inspect-events", {
              readPaths: ["codex-mission-control/src/mission-orchestrator.js"],
              writePaths: [],
            }),
            task("write-tests", {
              readPaths: ["codex-mission-control/tests"],
              writePaths: ["codex-mission-control/tests"],
            }),
            task("write-docs", {
              readPaths: ["codex-mission-control"],
              writePaths: ["codex-mission-control/docs"],
            }),
            task(
              "review-safe-wave",
              {
                readPaths: ["codex-mission-control"],
                writePaths: [],
              },
              {
                dependsOn: [
                  "write-shared",
                  "write-shared-child",
                  "inspect-events",
                  "write-tests",
                  "write-docs",
                ],
                workKind: "review",
                risk: "high",
                effectivePermission: "read-only",
              },
            ),
          ],
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept the safe execution-wave plan",
  });

  const afterWave = await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the first safe execution wave",
  });

  assert.deepEqual(
    transportRequests.map((request) => ({
      assignmentId: request.assignment.id,
      roleId: request.roleId,
      permission: request.permission,
    })),
    [
      {
        assignmentId: "write-shared",
        roleId: "terra_builder",
        permission: "workspace-write",
      },
      {
        assignmentId: "inspect-events",
        roleId: "luna_worker",
        permission: "read-only",
      },
      {
        assignmentId: "write-tests",
        roleId: "terra_builder",
        permission: "workspace-write",
      },
    ],
  );
  assert.deepEqual(afterWave.execution.waves[0], {
    id: afterWave.execution.waves[0].id,
    capacity: 4,
    reservedSlots: 1,
    workerCapacity: 3,
    assignmentIds: ["write-shared", "inspect-events", "write-tests"],
    serializedAssignmentIds: ["write-shared-child"],
    deferredAssignmentIds: ["write-docs"],
    status: "COMPLETED",
  });
  assert.deepEqual(
    afterWave.execution.nodes.map((node) => [node.assignment.id, node.status]),
    [
      ["write-shared", "COMPLETED"],
      ["write-shared-child", "PENDING"],
      ["inspect-events", "COMPLETED"],
      ["write-tests", "COMPLETED"],
      ["write-docs", "PENDING"],
      ["review-safe-wave", "PENDING"],
    ],
  );
  assert.deepEqual(afterWave.execution.frontier, [
    "write-shared-child",
    "write-docs",
  ]);
  assert.equal(afterWave.status, "RUNNING");
});

test("Decision Room requires structured Evidence-backed judgment before consequential work reaches the frontier", () => {
  const orchestrator = createHarness();
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission with a consequential decision",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Decision Room Context"),
    },
    actor: "mission-owner",
    reason: "Capture decision Context",
  });
  const planned = orchestrator.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        taskGraph: {
          capacity: 4,
          coordinationRequired: true,
          assignments: [
            {
              ...boundedAssignment,
              id: "choose-event-seam",
              goal: "Choose the event-sourced execution seam",
              dependsOn: [],
              requiresDecision: true,
              workKind: "architecture",
              risk: "high",
            },
            {
              ...boundedAssignment,
              id: "review-event-seam",
              goal: "Review the chosen event seam",
              dependsOn: ["choose-event-seam"],
              workKind: "review",
              risk: "high",
            },
          ],
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept a plan with consequential architecture work",
  });

  assert.deepEqual(planned.execution.frontier, []);
  assert.deepEqual(planned.execution.decisionRequiredAssignmentIds, [
    "choose-event-seam",
  ]);
  assert.deepEqual(planned.allowedActions, [
    "open_decision_room",
    "revise_context",
    "block_mission",
    "cancel_mission",
  ]);

  const room = {
    id: "decision-room:event-seam",
    assignmentId: "choose-event-seam",
    assignmentAttempt: 1,
    question: "Where should execution-wave invariants live?",
    participantRoles: ["orchestrator", "sol_architect", "sol_reviewer"],
    participantInputs: [
      {
        roleId: "orchestrator",
        contribution: "Keep execution sequencing auditable",
        evidenceRefs: ["evidence://event-seam-options"],
      },
      {
        roleId: "sol_architect",
        contribution: "Localize the event replay invariants",
        evidenceRefs: ["evidence://event-seam-options"],
      },
      {
        roleId: "sol_reviewer",
        contribution: "Require forged-event replay coverage",
        evidenceRefs: ["evidence://event-seam-options"],
      },
    ],
    expectedOutput: "A reusable event-seam decision Artifact",
    alternatives: [
      {
        id: "inline",
        label: "Inline in the Orchestrator",
        tradeoffs: ["Fewer files", "Lower locality"],
      },
      {
        id: "deep-module",
        label: "Dedicated deep execution module",
        tradeoffs: ["Small extra seam", "Higher replay locality"],
      },
    ],
    recommendation: {
      alternativeId: "deep-module",
      rationale: "Keep graph and wave invariants in one replayable module",
    },
    validationPlan: [
      "Replay forged wave events",
      "Run concurrent ownership contract tests",
    ],
  };

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "OPEN_DECISION_ROOM",
        payload: {
          decisionRoom: {
            ...room,
            alternatives: [{ id: "inline", label: "Inline", tradeoffs: [] }],
          },
        },
        actor: "mission-owner",
        reason: "Attempt to open an incomplete Decision Room",
        evidenceRefs: ["evidence://event-seam-options"],
      }),
    /Decision Room alternative trade-offs are required/,
  );

  const opened = orchestrator.execute(created.id, {
    type: "OPEN_DECISION_ROOM",
    payload: { decisionRoom: room },
    actor: "mission-owner",
    reason: "Open the event-seam Decision Room",
    evidenceRefs: ["evidence://event-seam-options"],
  });
  assert.deepEqual(opened.execution.decisionRooms, [
    {
      ...room,
      inputEvidenceRefs: ["evidence://event-seam-options"],
      status: "OPEN",
      decision: null,
      decisionArtifact: null,
    },
  ]);
  assert.deepEqual(opened.allowedActions, [
    "resolve_decision_room",
    "revise_context",
    "block_mission",
    "cancel_mission",
  ]);

  const resolved = orchestrator.execute(created.id, {
    type: "RESOLVE_DECISION_ROOM",
    payload: {
      decision: {
        roomId: room.id,
        assignmentAttempt: 1,
        selectedAlternativeId: "deep-module",
        rationale: "The replay invariants need one source of truth",
        artifact: {
          id: "decision-artifact:event-seam",
          uri: "decision://event-seam",
          summary: "Use a deep execution module with replay contracts",
        },
      },
    },
    actor: "mission-owner",
    reason: "Resolve the event-seam Decision Room",
  });
  assert.deepEqual(resolved.execution.frontier, ["choose-event-seam"]);
  assert.deepEqual(resolved.execution.decisionRooms[0].decision, {
    assignmentAttempt: 1,
    selectedAlternativeId: "deep-module",
    rationale: "The replay invariants need one source of truth",
    actor: "mission-owner",
  });
  assert.equal(resolved.execution.decisionRooms[0].status, "RESOLVED");
  assert.deepEqual(resolved.allowedActions, [
    "dispatch_execution_wave",
    "revise_context",
    "block_mission",
    "cancel_mission",
  ]);
});

test("independent reviewer findings return only owned work and its downstream review to correction", async () => {
  const attempts = new Map();
  const transportRequests = [];
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        const assignmentId = request.assignment.id;
        const attempt = (attempts.get(assignmentId) ?? 0) + 1;
        attempts.set(assignmentId, attempt);
        transportRequests.push({
          assignmentId,
          attempt,
          roleId: request.roleId,
          permission: request.permission,
        });
        yield {
          kind: "started",
          runId: `run:${assignmentId}:${attempt}`,
          occurredAt: `2026-08-08T10:0${attempt}:00.000Z`,
        };
        yield {
          kind: "completed",
          runId: `run:${assignmentId}:${attempt}`,
          occurredAt: `2026-08-08T10:0${attempt}:30.000Z`,
          summary: `Completed ${assignmentId} attempt ${attempt}`,
          artifacts: [
            {
              name: `${assignmentId}-${attempt}`,
              uri: `artifact://${assignmentId}/${attempt}`,
              ...(assignmentId === "review-candidate"
                ? {
                    reviewOutcome: {
                      outcome: "CHANGES_REQUESTED",
                      candidateArtifactRefs:
                        request.reviewContext.candidateArtifactRefs,
                      findings: [
                        {
                          triggeringScenario:
                            "build-a transport emits a terminal error",
                          ownerAssignmentId: "build-a",
                          summary:
                            "Preserve Assignment ownership on the error event",
                        },
                      ],
                    },
                  }
                : {}),
            },
          ],
          evidence: [
            {
              ref: `evidence://${assignmentId}/${attempt}`,
              kind: assignmentId === "review-candidate" ? "review" : "test",
              summary: `Evidence for ${assignmentId} attempt ${attempt}`,
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const created = orchestrator.createMission({
    brief: validBrief,
    actor: "mission-owner",
    reason: "Create a Mission for targeted review correction",
  });
  orchestrator.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Targeted correction Context"),
    },
    actor: "mission-owner",
    reason: "Capture targeted correction Context",
  });
  const writableTask = (id, writePath) => ({
    ...boundedAssignment,
    id,
    goal: `Build ${id}`,
    dependsOn: [],
    workKind: "implementation",
    risk: "medium",
    effectivePermission: "workspace-write",
    ownershipBoundary: {
      readPaths: [writePath],
      writePaths: [writePath],
    },
  });
  orchestrator.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: {
      plan: {
        taskGraph: {
          capacity: 4,
          coordinationRequired: true,
          assignments: [
            writableTask("build-a", "codex-mission-control/src/a"),
            writableTask("build-b", "codex-mission-control/src/b"),
            {
              ...boundedAssignment,
              id: "review-candidate",
              goal: "Independently review both build outputs",
              dependsOn: ["build-a", "build-b"],
              workKind: "review",
              risk: "high",
              expectedEvidence: ["Findings name scenario and owner"],
            },
          ],
        },
      },
    },
    actor: "mission-owner",
    reason: "Accept a plan with independent review",
  });

  await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch both independent build Assignments",
  });
  const reviewed = await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch the independent review Assignment",
  });
  assert.equal(reviewed.status, "IN_REVIEW");
  assert.deepEqual(
    reviewed.execution.nodes.find(
      (node) => node.assignment.id === "review-candidate",
    ).agent,
    {
      roleId: "sol_reviewer",
      roleName: "Sol Reviewer",
      capability: "review",
      effectivePermission: "read-only",
      independent: true,
    },
  );

  assert.throws(
    () =>
      orchestrator.execute(created.id, {
        type: "REJECT_REVIEW",
        payload: {
          review: {
            summary: "Attempt to replace the reviewed candidate closure",
            reviewerAssignmentId: "review-candidate",
            outcome: "CHANGES_REQUESTED",
            candidateArtifactRefs: ["artifact://forged-candidate"],
            findings: [
              {
                triggeringScenario: "build-a transport emits a terminal error",
                ownerAssignmentId: "build-a",
                summary: "Preserve Assignment ownership on the error event",
              },
            ],
          },
        },
        actor: "agent:sol_reviewer",
        reason: "Attempt to reject a different candidate closure",
        evidenceRefs: ["evidence://review-candidate/1"],
      }),
    /current independent reviewer Evidence and actor/,
  );

  const changesRequested = orchestrator.execute(created.id, {
    type: "REJECT_REVIEW",
    payload: {
      review: {
        summary: "Replay loses the owner on one execution error path",
        reviewerAssignmentId: "review-candidate",
        outcome: "CHANGES_REQUESTED",
        candidateArtifactRefs: [
          "artifact://build-a/1",
          "artifact://build-b/1",
        ],
        findings: [
          {
            triggeringScenario: "build-a transport emits a terminal error",
            ownerAssignmentId: "build-a",
            summary: "Preserve Assignment ownership on the error event",
          },
        ],
      },
    },
    actor: "agent:sol_reviewer",
    reason: "Independent review returned one owned finding",
    evidenceRefs: ["evidence://review-candidate/1"],
  });

  assert.equal(changesRequested.status, "CHANGES_REQUESTED");
  assert.deepEqual(changesRequested.changeRequest.affectedAssignmentIds, [
    "build-a",
  ]);
  assert.deepEqual(
    changesRequested.execution.nodes.map((node) => [
      node.assignment.id,
      node.status,
    ]),
    [
      ["build-a", "CHANGES_REQUESTED"],
      ["build-b", "COMPLETED"],
      ["review-candidate", "PENDING"],
    ],
  );
  assert.deepEqual(changesRequested.execution.frontier, ["build-a"]);
  assert.ok(
    changesRequested.invalidatedArtifactRefs.includes("artifact://build-a/1"),
  );
  assert.ok(
    changesRequested.invalidatedArtifactRefs.includes(
      "artifact://review-candidate/1",
    ),
  );
  assert.ok(
    !changesRequested.invalidatedArtifactRefs.includes("artifact://build-b/1"),
  );
  assert.deepEqual(changesRequested.allowedActions, [
    "dispatch_execution_wave",
    "revise_context",
    "block_mission",
    "cancel_mission",
  ]);

  const corrected = await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Dispatch only the owned correction",
  });
  assert.deepEqual(corrected.execution.frontier, ["review-candidate"]);
  const rereviewed = await orchestrator.dispatchExecutionWave(created.id, {
    actor: "mission-owner",
    reason: "Re-run the downstream independent review",
  });

  assert.equal(rereviewed.status, "IN_REVIEW");
  assert.deepEqual(
    rereviewed.execution.nodes.map((node) => [
      node.assignment.id,
      node.artifacts[0].uri,
    ]),
    [
      ["build-a", "artifact://build-a/2"],
      ["build-b", "artifact://build-b/1"],
      ["review-candidate", "artifact://review-candidate/2"],
    ],
  );
  assert.deepEqual(transportRequests, [
    {
      assignmentId: "build-a",
      attempt: 1,
      roleId: "terra_builder",
      permission: "workspace-write",
    },
    {
      assignmentId: "build-b",
      attempt: 1,
      roleId: "terra_builder",
      permission: "workspace-write",
    },
    {
      assignmentId: "review-candidate",
      attempt: 1,
      roleId: "sol_reviewer",
      permission: "read-only",
    },
    {
      assignmentId: "build-a",
      attempt: 2,
      roleId: "terra_builder",
      permission: "workspace-write",
    },
    {
      assignmentId: "review-candidate",
      attempt: 2,
      roleId: "sol_reviewer",
      permission: "read-only",
    },
  ]);
});

test("a completed Mission promotes a reviewed Playbook Candidate without reopening Mission completion", async () => {
  const orchestrator = createPlaybookReviewHarness();
  const { created, completed, execute } = createCompletedPlaybookMission(
    orchestrator,
  );

  const evaluationSet = {
    id: "evaluation-set:retry-guidance",
    version: "2026-08-25",
    caseIds: ["case:retry-evidence", "case:review-handoff"],
  };
  const protectedConfiguration = {
    systemPrompts: { missionPolicy: "Keep execution bounded and auditable." },
    agentProfiles: { reviewer: "sol_reviewer" },
    securityPolicy: { releaseRequiresHumanApproval: true },
  };
  const baselineMetrics = {
    acceptancePassRate: 0.8,
    criticalRegressions: 0,
    reviewFindings: 4,
    retries: 5,
    cycleTimeMs: 120000,
    tokenUse: 10000,
  };
  const candidateInput = {
    retrospective: {
      id: "retrospective:playbook-mission",
      version: "1",
      missionId: created.id,
      outcome: "COMPLETED",
      recurringFailurePattern: "Retry evidence is missing from repeated reviews.",
      metrics: baselineMetrics,
      evidenceRefs: ["evidence://playbook-retrospective"],
    },
    baseline: {
      id: "playbook:baseline",
      version: "1",
      evaluationSet,
      protectedConfiguration,
      metrics: baselineMetrics,
      criticalRegressionCaseIds: [],
      caseResults: [
        {
          caseId: "case:retry-evidence",
          artifactRef: "artifact://playbook/baseline/1/case-retry-evidence",
          evidenceRefs: [
            "evidence://playbook/baseline/1/case-retry-evidence",
          ],
          acceptanceScore: 0.8,
          criticalRegression: false,
          reviewFindings: 2,
          retries: 3,
          cycleTimeMs: 60000,
          tokenUse: 5000,
        },
        {
          caseId: "case:review-handoff",
          artifactRef: "artifact://playbook/baseline/1/case-review-handoff",
          evidenceRefs: [
            "evidence://playbook/baseline/1/case-review-handoff",
          ],
          acceptanceScore: 0.8,
          criticalRegression: false,
          reviewFindings: 2,
          retries: 2,
          cycleTimeMs: 60000,
          tokenUse: 5000,
        },
      ],
    },
    candidate: {
      id: "playbook:retry-guidance",
      version: "2",
      basedOn: { id: "playbook:baseline", version: "1" },
      evaluationSet,
      protectedConfiguration,
      change: {
        summary: "Add a retry-evidence checklist.",
        scope: "playbook procedure only",
      },
      metrics: {
        acceptancePassRate: 0.9,
        criticalRegressions: 0,
        reviewFindings: 2,
        retries: 3,
        cycleTimeMs: 100000,
        tokenUse: 9000,
      },
      criticalRegressionCaseIds: [],
      caseResults: [
        {
          caseId: "case:retry-evidence",
          artifactRef: "artifact://playbook/candidate/2/case-retry-evidence",
          evidenceRefs: [
            "evidence://playbook/candidate/2/case-retry-evidence",
          ],
          acceptanceScore: 0.9,
          criticalRegression: false,
          reviewFindings: 1,
          retries: 1,
          cycleTimeMs: 50000,
          tokenUse: 4500,
        },
        {
          caseId: "case:review-handoff",
          artifactRef: "artifact://playbook/candidate/2/case-review-handoff",
          evidenceRefs: [
            "evidence://playbook/candidate/2/case-review-handoff",
          ],
          acceptanceScore: 0.9,
          criticalRegression: false,
          reviewFindings: 1,
          retries: 2,
          cycleTimeMs: 50000,
          tokenUse: 4500,
        },
      ],
    },
    declaredTarget: {
      metric: "acceptancePassRate",
      minimumImprovement: 0.05,
    },
  };

  const evaluated = execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  assert.deepEqual(evaluated.playbook.candidate, candidateInput.candidate);
  const requested = execute(
    "REQUEST_PLAYBOOK_PROMOTION",
    { request: {} },
    "Request promotion after the comparison passed",
  );
  const reviewed = await dispatchPlaybookReview(orchestrator, created.id);
  const promoted = execute(
    "APPROVE_PLAYBOOK_PROMOTION",
    {
      approval: {
        rationale: "The owner accepts the reviewed improvement target.",
      },
    },
    "Mission owner approves the reviewed Playbook Candidate",
    ["evidence://playbook-independent-review"],
  );

  assert.deepEqual(
    {
      completedStatus: completed.status,
      evaluatedStatus: evaluated.status,
      requestedStatus: requested.status,
      reviewedStatus: reviewed.status,
      promotedStatus: promoted.status,
      playbookStatus: promoted.playbook.status,
      activeVersion: promoted.playbook.activePromotedVersionId,
      promotedVersionCount: promoted.playbook.promotedVersions.length,
      eventTypes: promoted.events.slice(-5).map((event) => event.type),
    },
    {
      completedStatus: "COMPLETED",
      evaluatedStatus: "COMPLETED",
      requestedStatus: "COMPLETED",
      reviewedStatus: "COMPLETED",
      promotedStatus: "COMPLETED",
      playbookStatus: "PROMOTED",
      activeVersion: "playbook:retry-guidance@2",
      promotedVersionCount: 2,
      eventTypes: [
        "PLAYBOOK_CANDIDATE_EVALUATED",
        "PLAYBOOK_PROMOTION_REQUESTED",
        "PLAYBOOK_REVIEW_DISPATCHED",
        "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
        "PLAYBOOK_PROMOTED",
      ],
    },
  );
});

test("a release-authorized human can reject an evaluated Playbook Candidate without promoting it", () => {
  const orchestrator = createHarness();
  const { created, execute } = createCompletedPlaybookMission(orchestrator);

  execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  const rejected = execute(
    "REJECT_PLAYBOOK_CANDIDATE",
    {
      rejection: {
        rationale: "The owner will retain the current retry guidance this cycle.",
      },
    },
    "Mission owner rejects the evaluated candidate",
  );

  assert.deepEqual(
    {
      status: rejected.status,
      playbookStatus: rejected.playbook.status,
      promotedVersions: rejected.playbook.promotedVersions,
      rejectionHistory: rejected.playbook.rejectionHistory,
      lastEventType: rejected.events.at(-1).type,
    },
    {
      status: "COMPLETED",
      playbookStatus: "REJECTED",
      promotedVersions: [],
      rejectionHistory: [
        {
          candidateId: "playbook:retry-guidance",
          candidateVersion: "2",
          decision: "REJECTED",
          actor: "mission-owner",
          rationale: "The owner will retain the current retry guidance this cycle.",
          decidedAt: "2026-07-28T08:00:00.000Z",
        },
      ],
      lastEventType: "PLAYBOOK_REJECTED",
    },
  );
});

test("a release-authorized human can roll back an active promoted Playbook version without rewriting it", async () => {
  const orchestrator = createPlaybookReviewHarness();
  const { created, execute } = createCompletedPlaybookMission(orchestrator);

  execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  execute(
    "REQUEST_PLAYBOOK_PROMOTION",
    { request: {} },
    "Request promotion after the comparison passed",
  );
  await dispatchPlaybookReview(orchestrator, created.id);
  const promoted = execute(
    "APPROVE_PLAYBOOK_PROMOTION",
    { approval: { rationale: "The owner approves the reviewed candidate." } },
    "Mission owner approves the reviewed Playbook Candidate",
    ["evidence://playbook-independent-review"],
  );
  const immutableVersions = structuredClone(promoted.playbook.promotedVersions);

  const rolledBack = execute(
    "ROLLBACK_PLAYBOOK_VERSION",
    {
      rollback: {
        rationale: "Observed production conditions no longer match the evaluation cases.",
      },
    },
    "Mission owner rolls back the active Playbook version",
  );

  assert.deepEqual(
    {
      status: rolledBack.status,
      playbookStatus: rolledBack.playbook.status,
      activeVersion: rolledBack.playbook.activePromotedVersionId,
      versions: rolledBack.playbook.promotedVersions,
      rollbackHistory: rolledBack.playbook.rollbackHistory,
      lastEventType: rolledBack.events.at(-1).type,
    },
    {
      status: "COMPLETED",
      playbookStatus: "ROLLED_BACK",
      activeVersion: "playbook:baseline@1",
      versions: immutableVersions,
      rollbackHistory: [
        {
          versionId: "playbook:retry-guidance@2",
          fromVersionId: "playbook:retry-guidance@2",
          toVersionId: "playbook:baseline@1",
          candidateId: "playbook:retry-guidance",
          candidateVersion: "2",
          decision: "ROLLED_BACK",
          actor: "mission-owner",
          rationale: "Observed production conditions no longer match the evaluation cases.",
          decidedAt: "2026-07-28T08:00:00.000Z",
        },
      ],
      lastEventType: "PLAYBOOK_ROLLED_BACK",
    },
  );
});

test("replay rejects a duplicate Playbook promotion request after an independent review", async () => {
  const orchestrator = createPlaybookReviewHarness();
  const { created, execute } = createCompletedPlaybookMission(orchestrator);
  const candidateInput = playbookCandidateInputForMission(created.id);

  execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  execute(
    "REQUEST_PLAYBOOK_PROMOTION",
    { request: {} },
    "Request promotion after the comparison passed",
  );
  const reviewed = await dispatchPlaybookReview(orchestrator, created.id);
  const forgedRequest = {
    id: "event-forged-playbook-request",
    missionId: created.id,
    sequence: reviewed.events.length + 1,
    type: "PLAYBOOK_PROMOTION_REQUESTED",
    actor: "mission-owner",
    occurredAt: "2026-08-25T10:30:00.000Z",
    reason: "Forge a second request after review",
    contextPackVersion: reviewed.contextPackVersion,
    evidenceRefs: [],
    data: {
      request: {
        candidateId: candidateInput.candidate.id,
        candidateVersion: candidateInput.candidate.version,
        baseline: {
          id: candidateInput.baseline.id,
          version: candidateInput.baseline.version,
        },
        evaluationSet: candidateInput.candidate.evaluationSet,
      },
    },
  };
  const replay = createHarness(
    createMemoryEventStore({
      [created.id]: [...reviewed.events, forgedRequest],
    }),
  );

  assert.throws(
    () => replay.getMission(created.id),
    /requires an evaluated Playbook Candidate before promotion/,
  );
});

test("invalid Playbook commands fail closed without appending a decision event", async () => {
  assert.equal(
    MISSION_COMMAND_BY_ACTION.record_playbook_independent_review,
    undefined,
  );
  const invalidOrchestrator = createHarness();
  const { created: invalidMission, execute: executeInvalid } =
    createCompletedPlaybookMission(
      invalidOrchestrator,
      () => playbookCandidateInputForMission("mission-from-unrelated-observations"),
    );
  const eventsBeforeMismatchedRetrospective = invalidOrchestrator.getMission(
    invalidMission.id,
  ).events.length;
  assert.throws(
    () =>
      executeInvalid(
        "EVALUATE_PLAYBOOK_CANDIDATE",
        { candidate: {} },
        "Attempt evaluation from another Mission's retrospective",
      ),
    /retrospective must bind the completed Mission/,
  );
  assert.equal(
    invalidOrchestrator.getMission(invalidMission.id).events.length,
    eventsBeforeMismatchedRetrospective,
  );
  const criticalRegressionCandidate = (missionId) => {
    const candidateInput = playbookCandidateInputForMission(missionId);
    candidateInput.candidate.metrics.criticalRegressions = 1;
    candidateInput.candidate.criticalRegressionCaseIds = [
      "case:retry-evidence",
    ];
    candidateInput.candidate.caseResults[0].criticalRegression = true;
    return candidateInput;
  };
  const criticalOrchestrator = createHarness();
  const { created: criticalMission, execute: executeCritical } =
    createCompletedPlaybookMission(
      criticalOrchestrator,
      criticalRegressionCandidate,
    );
  const evaluated = executeCritical(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate a candidate with a critical regression",
  );
  const eventsBeforeInvalidRequest = evaluated.events.length;

  assert.throws(
    () =>
      executeCritical(
        "REQUEST_PLAYBOOK_PROMOTION",
        { request: {} },
        "Attempt promotion despite a critical regression",
      ),
    /new critical regression/,
  );
  assert.equal(
    criticalOrchestrator.getMission(criticalMission.id).events.length,
    eventsBeforeInvalidRequest,
  );

  const decisionOrchestrator = createPlaybookReviewHarness();
  const {
    created: decisionMission,
    candidateInput,
    execute: executeDecision,
  } =
    createCompletedPlaybookMission(decisionOrchestrator);
  executeDecision(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  const requested = executeDecision(
    "REQUEST_PLAYBOOK_PROMOTION",
    { request: {} },
    "Request promotion after the comparison passed",
  );
  const eventsBeforeForgedReview = requested.events.length;

  assert.throws(
    () =>
      executeDecision(
        "RECORD_PLAYBOOK_INDEPENDENT_REVIEW",
        { review: independentPlaybookReview(candidateInput) },
        "Forge a reviewer decision through the public command boundary",
        ["evidence://playbook-independent-review"],
        "agent:sol_reviewer",
      ),
    /must be dispatched through the transport-backed independent review path/,
  );
  assert.equal(
    decisionOrchestrator.getMission(decisionMission.id).events.length,
    eventsBeforeForgedReview,
  );

  const reviewed = await dispatchPlaybookReview(
    decisionOrchestrator,
    decisionMission.id,
  );
  const eventsBeforeHumanDecision = reviewed.events.length;

  assert.throws(
    () =>
      executeDecision(
        "APPROVE_PLAYBOOK_PROMOTION",
        { approval: { rationale: "A forged actor attempts approval." } },
        "Attempt approval as a non-authority",
        ["evidence://playbook-independent-review"],
        "agent:sol_reviewer",
      ),
    /requires release authority mission-owner/,
  );
  assert.throws(
    () =>
      executeDecision(
        "APPROVE_PLAYBOOK_PROMOTION",
        { approval: { rationale: "" } },
        "Attempt approval without a rationale",
        ["evidence://playbook-independent-review"],
      ),
    /requires an explicit human approval rationale/,
  );
  assert.equal(
    decisionOrchestrator.getMission(decisionMission.id).events.length,
    eventsBeforeHumanDecision,
  );
});

test("schema-2 and legacy completed histories replay with a default empty Playbook", () => {
  const source = createHarness();
  const { created, completed } = createCompletedPlaybookMission(source);
  const schema2Store = createMemoryEventStore({
    [created.id]: completed.events,
  });
  const legacyEvents = completed.events.map((event) => {
    const legacyEvent = structuredClone(event);
    delete legacyEvent.schemaVersion;
    return legacyEvent;
  });
  const legacyStore = createMemoryEventStore({ [created.id]: legacyEvents });

  const schema2Replay = createHarness(schema2Store).getMission(created.id);
  const legacyReplay = createHarness(legacyStore).getMission(created.id);

  assert.deepEqual(schema2Replay, completed);
  assert.deepEqual(
    {
      status: legacyReplay.status,
      playbook: legacyReplay.playbook,
      eventTypes: legacyReplay.events.map((event) => event.type),
      storedHistory: legacyStore.load(created.id),
    },
    {
      status: "COMPLETED",
      playbook: {
        status: "NOT_EVALUATED",
        retrospective: null,
        baseline: null,
        candidate: null,
        declaredTarget: null,
        comparison: null,
        reviewDispatch: null,
        independentReview: null,
        humanDecision: null,
        promotedVersions: [],
        rejectionHistory: [],
        rollbackHistory: [],
        reviewRejectionHistory: [],
        decisionHistory: [],
        activePromotedVersionId: null,
      },
      eventTypes: completed.events.map((event) => event.type),
      storedHistory: legacyEvents,
    },
  );
  assert.deepEqual(schema2Store.load(created.id), completed.events);
});

test("schema-2 release Brief without typed gates stays readable but cannot progress", () => {
  const missionId = "mission-legacy-release-gates";
  const created = {
    schemaVersion: 2,
    id: "event-legacy-release-created",
    missionId,
    sequence: 1,
    type: "MISSION_CREATED",
    actor: "mission-owner",
    occurredAt: "2026-07-28T08:00:00.000Z",
    reason: "Historical release Mission before typed gates",
    contextPackVersion: 1,
    evidenceRefs: [],
    data: {
      brief: {
        ...validBrief,
        releaseRequired: true,
        releaseAuthorized: true,
        releaseAuthority: "release-owner",
        releasePlan: {
          residualRisk: "A rollback may still be required",
          intendedExternalAction: "Deploy the approved build",
          rollbackCommitment: "Restore the previous build",
        },
      },
    },
  };
  const orchestrator = createHarness(
    createMemoryEventStore({ [missionId]: [created] }),
  );

  const mission = orchestrator.getMission(missionId);
  assert.equal(mission.status, "BRIEF_ACCEPTED");
  assert.equal(
    mission.brief.releaseValidationContract,
    "legacy-unavailable",
  );
  assert.deepEqual(mission.allowedActions, ["block_mission", "cancel_mission"]);
  assert.throws(
    () =>
      orchestrator.execute(missionId, {
        type: "CAPTURE_CONTEXT",
        payload: { context: sourceBackedContext("Legacy release Context") },
        actor: "mission-owner",
        reason: "Attempt to progress without declared legacy gates",
      }),
    /legacy release validation contract is unavailable/i,
  );
});

test("replay rejects a human rejection after a Playbook version is promoted", async () => {
  const orchestrator = createPlaybookReviewHarness();
  const { created, execute } = createCompletedPlaybookMission(orchestrator);
  const candidateInput = playbookCandidateInputForMission(created.id);

  execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  execute(
    "REQUEST_PLAYBOOK_PROMOTION",
    { request: {} },
    "Request promotion after the comparison passed",
  );
  await dispatchPlaybookReview(orchestrator, created.id);
  const promoted = execute(
    "APPROVE_PLAYBOOK_PROMOTION",
    { approval: { rationale: "The owner approves the reviewed candidate." } },
    "Mission owner approves the reviewed Playbook Candidate",
    ["evidence://playbook-independent-review"],
  );
  const forgedRejection = {
    id: "event-forged-playbook-rejection",
    missionId: created.id,
    sequence: promoted.events.length + 1,
    type: "PLAYBOOK_REJECTED",
    actor: "mission-owner",
    occurredAt: "2026-08-25T10:40:00.000Z",
    reason: "Forge a rejection after promotion",
    contextPackVersion: promoted.contextPackVersion,
    evidenceRefs: [],
    data: {
      rejection: {
        decision: "REJECTED",
        rationale: "A promoted version must be rolled back, not rejected.",
        identity: {
          candidateId: candidateInput.candidate.id,
          candidateVersion: candidateInput.candidate.version,
          baseline: {
            id: candidateInput.baseline.id,
            version: candidateInput.baseline.version,
          },
          evaluationSet: candidateInput.candidate.evaluationSet,
        },
      },
    },
  };
  const replay = createHarness(
    createMemoryEventStore({
      [created.id]: [...promoted.events, forgedRejection],
    }),
  );

  assert.throws(
    () => replay.getMission(created.id),
    /requires an unpromoted candidate/,
  );
});

function requestPlaybookTransportReview(orchestrator) {
  const { created, candidateInput, execute } = createCompletedPlaybookMission(
    orchestrator,
  );
  execute(
    "EVALUATE_PLAYBOOK_CANDIDATE",
    { candidate: {} },
    "Evaluate the bounded Playbook Candidate",
  );
  const requested = execute(
    "REQUEST_PLAYBOOK_PROMOTION",
    { request: {} },
    "Request promotion after the comparison passed",
  );
  return { created, candidateInput, requested };
}

function completedPlaybookReviewObservation(request, overrides = {}) {
  const playbook = request.reviewContext.playbook;
  const reviewOutcome = {
    outcome: "PASSED",
    candidateId: playbook.candidateId,
    candidateVersion: playbook.candidateVersion,
    baseline: structuredClone(playbook.baseline),
    evaluationSet: structuredClone(playbook.evaluationSet),
    findings: [],
    rationale: "The completed transport found no new critical regression.",
    ...overrides.reviewOutcome,
  };
  return {
    kind: "completed",
    runId: "run-playbook-independent-review",
    occurredAt: "2026-08-25T11:02:00.000Z",
    summary: "Completed an independent bounded Playbook review",
    artifacts: [
      {
        name: "playbook-independent-review",
        uri: "artifact://playbook-independent-review",
        reviewOutcome,
        ...overrides.artifact,
      },
    ],
    evidence: [
      {
        ref: "evidence://playbook-independent-review",
        kind: "review",
        summary: "Independent review of the current Playbook Candidate",
      },
    ],
    ...overrides.observation,
  };
}

test("transport-backed Playbook review routes one bounded Sol Reviewer and records its completed Evidence", async () => {
  const transportRequests = [];
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        transportRequests.push(
          structuredClone({
            roleId: request.roleId,
            permission: request.permission,
            assignment: request.assignment,
            reviewContext: request.reviewContext,
          }),
        );
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request);
      },
    },
  });
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore, agentRouter);
  const { created, requested } = requestPlaybookTransportReview(orchestrator);

  const reviewed = await orchestrator.dispatchPlaybookIndependentReview(
    created.id,
    {
      actor: "mission-owner",
      reason: "Dispatch the current Playbook Candidate for independent review",
    },
  );

  assert.deepEqual(
    {
      roleId: transportRequests[0].roleId,
      permission: transportRequests[0].permission,
      workKind: transportRequests[0].assignment.workKind,
      risk: transportRequests[0].assignment.risk,
      effectivePermission: transportRequests[0].assignment.effectivePermission,
      readPaths: transportRequests[0].assignment.ownershipBoundary.readPaths,
      writePaths: transportRequests[0].assignment.ownershipBoundary.writePaths,
      identity: transportRequests[0].reviewContext.playbook,
    },
    {
      roleId: "sol_reviewer",
      permission: "read-only",
      workKind: "review",
      risk: "high",
      effectivePermission: "read-only",
      readPaths: [
        "src/mission-orchestrator.js",
        "src/playbook-candidate.js",
      ],
      writePaths: [],
      identity: {
        candidateId: requested.playbook.candidate.id,
        candidateVersion: requested.playbook.candidate.version,
        baseline: {
          id: requested.playbook.baseline.id,
          version: requested.playbook.baseline.version,
        },
        evaluationSet: requested.playbook.candidate.evaluationSet,
        comparison: requested.playbook.comparison,
        retrospective: requested.playbook.retrospective,
        baselineSnapshot: requested.playbook.baseline,
        candidateSnapshot: requested.playbook.candidate,
        declaredTarget: requested.playbook.declaredTarget,
      },
    },
  );

  const reviewEvents = reviewed.events.filter(
    (event) => event.type === "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
  );
  assert.deepEqual(
    {
      missionStatus: reviewed.status,
      playbookStatus: reviewed.playbook.status,
      reviewEvents: reviewEvents.length,
      actor: reviewEvents[0].actor,
      evidenceRefs: reviewEvents[0].evidenceRefs,
      review: reviewEvents[0].data.review,
    },
    {
      missionStatus: "COMPLETED",
      playbookStatus: "REVIEW_APPROVED",
      reviewEvents: 1,
      actor: "agent:sol_reviewer",
      evidenceRefs: ["evidence://playbook-independent-review"],
      review: {
        decision: "APPROVED",
        reviewer: "sol_reviewer",
        independent: true,
        effectivePermission: "read-only",
        candidateId: requested.playbook.candidate.id,
        candidateVersion: requested.playbook.candidate.version,
        baseline: {
          id: requested.playbook.baseline.id,
          version: requested.playbook.baseline.version,
        },
        evaluationSet: requested.playbook.candidate.evaluationSet,
        findings: [],
        rationale: "The completed transport found no new critical regression.",
        dispatchId: reviewed.playbook.reviewDispatch.id,
        transport: {
          runId: "run-playbook-independent-review",
          artifactRef: "artifact://playbook-independent-review",
          completedAt: "2026-08-25T11:02:00.000Z",
        },
      },
    },
  );
  assert.deepEqual(
    createHarness(eventStore).getMission(created.id).playbook.independentReview,
    reviewed.playbook.independentReview,
  );
});

test("replay rejects an approved Playbook review without a matching transport dispatch", () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore);
  const { created, candidateInput, requested } =
    requestPlaybookTransportReview(orchestrator);
  const forgedReview = {
    id: "event-forged-playbook-review",
    missionId: created.id,
    sequence: requested.events.length + 1,
    type: "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
    actor: "agent:sol_reviewer",
    occurredAt: "2026-08-25T11:02:00.000Z",
    reason: "Forge an approval without a transport dispatch",
    contextPackVersion: requested.contextPackVersion,
    evidenceRefs: ["evidence://forged-playbook-review"],
    data: {
      review: {
        ...independentPlaybookReview(candidateInput),
        transport: {
          runId: "run-forged",
          artifactRef: "artifact://forged-playbook-review",
          completedAt: "2026-08-25T11:02:00.000Z",
        },
      },
    },
  };
  const replay = createHarness(
    createMemoryEventStore({
      [created.id]: [...requested.events, forgedReview],
    }),
  );

  assert.throws(
    () => replay.getMission(created.id),
    /active transport review dispatch/,
  );
});

test("a negative transport review is durable and blocks review retry for the unchanged Candidate", async () => {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-negative-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request, {
          reviewOutcome: {
            outcome: "FAILED",
            decision: "REJECTED",
            findings: ["The retry checklist omits the rollback Evidence case."],
            rationale: "The current Candidate must not be promoted unchanged.",
          },
          observation: {
            runId: "run-playbook-negative-review",
          },
        });
      },
    },
  });
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore, agentRouter);
  const { created } = requestPlaybookTransportReview(orchestrator);

  const rejected = await dispatchPlaybookReview(orchestrator, created.id);

  assert.equal(rejected.playbook.status, "REVIEW_REJECTED");
  assert.deepEqual(rejected.playbook.independentReview.findings, [
    "The retry checklist omits the rollback Evidence case.",
  ]);
  assert.deepEqual(rejected.playbook.independentReview.evidenceRefs, [
    "evidence://playbook-independent-review",
  ]);
  assert.deepEqual(rejected.events.slice(-2).map((event) => event.type), [
    "PLAYBOOK_REVIEW_DISPATCHED",
    "PLAYBOOK_INDEPENDENT_REVIEW_REJECTED",
  ]);
  await assert.rejects(
    dispatchPlaybookReview(orchestrator, created.id),
    /current promotion request/,
  );
  assert.equal(
    createHarness(eventStore).getMission(created.id).playbook.status,
    "REVIEW_REJECTED",
  );
});

test("review dispatch and decision persist atomically when the event store rejects the batch", async () => {
  const backingStore = createMemoryEventStore();
  const faultingStore = {
    append(missionId, events, options) {
      if (
        events.some((event) =>
          [
            "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
            "PLAYBOOK_INDEPENDENT_REVIEW_REJECTED",
          ].includes(event.type),
        )
      ) {
        throw new Error("Simulated atomic review batch failure");
      }
      backingStore.append(missionId, events, options);
    },
    load: (...args) => backingStore.load(...args),
    listMissionIds: (...args) => backingStore.listMissionIds(...args),
    subscribe: (...args) => backingStore.subscribe(...args),
  };
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-atomic-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request, {
          observation: { runId: "run-playbook-atomic-review" },
        });
      },
    },
  });
  const orchestrator = createHarness(faultingStore, agentRouter);
  const { created, requested } = requestPlaybookTransportReview(orchestrator);

  await assert.rejects(
    dispatchPlaybookReview(orchestrator, created.id),
    /Simulated atomic review batch failure/,
  );

  const replayed = createHarness(backingStore).getMission(created.id);
  assert.equal(replayed.playbook.status, "PROMOTION_REQUESTED");
  assert.equal(replayed.events.length, requested.events.length);
  assert.equal(
    replayed.events.some((event) => event.type === "PLAYBOOK_REVIEW_DISPATCHED"),
    false,
  );
});

test("transport-backed Playbook review fails closed for bad routing and terminal output", async () => {
  const scenarios = [
    {
      name: "wrong-role routing",
      expectedError: /requires a read-only independent Sol Reviewer/,
      router({ adapter }) {
        return {
          route(assignment) {
            const routing = adapter.route(assignment);
            return {
              ...routing,
              agent: {
                ...routing.agent,
                roleId: "terra_builder",
                roleName: "Terra Builder",
                capability: "implementation",
                independent: undefined,
              },
            };
          },
          run(...args) {
            return adapter.run(...args);
          },
        };
      },
    },
    {
      name: "blocked transport",
      transport: async function* run() {
        yield {
          kind: "started",
          runId: "run-blocked-playbook-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield {
          kind: "blocked",
          runId: "run-blocked-playbook-review",
          occurredAt: "2026-08-25T11:01:00.000Z",
          blocker: "The reviewer cannot inspect a missing Evidence source.",
          attemptedAlternatives: ["Checked the bounded Playbook context"],
          requiredAuthorityOrInput: "Provide the missing retrospective Evidence",
        };
      },
    },
    {
      name: "transport error",
      expectedError: /review transport is unavailable/,
      transport: async function* run() {
        throw new Error("Playbook review transport is unavailable");
      },
    },
    {
      name: "missing Evidence",
      expectedError: /Completed Run requires at least one structured Evidence item/,
      transport: async function* run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        const observation = completedPlaybookReviewObservation(request);
        observation.evidence = [];
        yield observation;
      },
    },
    {
      name: "missing structured review outcome",
      expectedError: /requires exactly one structured reviewOutcome Artifact/,
      transport: async function* run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request, {
          artifact: { reviewOutcome: undefined },
        });
      },
    },
    {
      name: "stale candidate identity",
      expectedError:
        /must bind the current Playbook Candidate, Baseline, and evaluation set/,
      transport: async function* run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request, {
          reviewOutcome: { candidateVersion: "stale-version" },
        });
      },
    },
    {
      name: "conflicting approved outcome",
      expectedError: /requires a coherent approved or rejected structured reviewOutcome/,
      transport: async function* run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request, {
          reviewOutcome: { decision: "REJECTED" },
        });
      },
    },
    {
      name: "decision without transport outcome",
      expectedError: /requires a coherent approved or rejected structured reviewOutcome/,
      transport: async function* run(request) {
        yield {
          kind: "started",
          runId: "run-playbook-independent-review",
          occurredAt: "2026-08-25T11:00:00.000Z",
        };
        yield completedPlaybookReviewObservation(request, {
          reviewOutcome: { outcome: undefined, decision: "APPROVED" },
        });
      },
    },
  ];

  for (const scenario of scenarios) {
    const adapter = createAgentRoutingAdapter({
      transport: {
        run:
          scenario.transport ??
          (async function* run() {
            throw new Error("Wrong-role routing must not start transport");
          }),
      },
    });
    const agentRouter = scenario.router ? scenario.router({ adapter }) : adapter;
    const eventStore = createMemoryEventStore();
    const orchestrator = createHarness(eventStore, agentRouter);
    const { created, requested } = requestPlaybookTransportReview(orchestrator);
    const eventsBefore = requested.events.length;

    const dispatch = orchestrator.dispatchPlaybookIndependentReview(created.id, {
      actor: "mission-owner",
      reason: `Attempt transport-backed review with ${scenario.name}`,
    });
    if (scenario.expectedError) {
      await assert.rejects(dispatch, scenario.expectedError, scenario.name);
    } else {
      const result = await dispatch;
      assert.equal(result.playbook.status, "PROMOTION_REQUESTED", scenario.name);
    }

    const replayed = createHarness(eventStore).getMission(created.id);
    assert.equal(
      replayed.events.length,
      eventsBefore,
      `${scenario.name} must not append an independent-review decision`,
    );
    assert.equal(
      replayed.playbook.status,
      "PROMOTION_REQUESTED",
      `${scenario.name} must leave the candidate awaiting independent review`,
    );
    assert.equal(
      replayed.events.filter(
        (event) => event.type === "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
      ).length,
      0,
      `${scenario.name} must not append the review event`,
    );
  }
});
