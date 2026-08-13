import assert from "node:assert/strict";
import test from "node:test";

import {
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

function createHarness(
  eventStore = createMemoryEventStore(),
  agentRouter = undefined,
) {
  let eventNumber = 0;

  return createMissionOrchestrator({
    eventStore,
    agentRouter,
    clock: () => "2026-07-28T08:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-001" : `event-${++eventNumber}`,
  });
}

function advanceToPlanned(orchestrator, missionId) {
  orchestrator.execute(missionId, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: {
        summary: "Bounded source inspection",
        sourceRefs: ["src/mission-orchestrator.js"],
      },
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

function createReleaseMissionAtApproval(
  orchestrator,
  {
    artifact = releaseArtifact(
      "release-candidate-1",
      "artifact://release-candidate-1",
    ),
    stopBeforeReview = false,
    stopBeforeValidation = false,
  } = {},
) {
  const releaseBrief = {
    ...validBrief,
    releaseRequired: true,
    releaseAuthorized: true,
    releaseAuthority: "release-owner",
    releasePlan: {
      residualRisk: "A rollback may still be required after deployment",
      intendedExternalAction: "Deploy the approved build to production",
      rollbackCommitment: "Restore the previous immutable release",
    },
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
    { context: { summary: "Release Context Pack" } },
    "Capture release Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "validate", "approve"] } },
    "Accept release plan",
  );
  execute(
    "START_RUN",
    { run: { id: "run-release-1", agentRole: "terra_builder" } },
    "Start release candidate",
  );
  execute(
    "SUBMIT_ARTIFACT",
    { artifact },
    "Submit exact release candidate",
    ["evidence://artifact-release-1"],
  );
  if (!stopBeforeReview) {
    execute(
      "PASS_REVIEW",
      { review: { summary: "Independent review passed" } },
      "Pass independent review",
      ["evidence://review-release-1"],
    );
  }
  return {
    created,
    execute,
    approvalRequired: stopBeforeReview || stopBeforeValidation
      ? null
      : execute(
          "PASS_VALIDATION",
          { validation: { summary: "Release acceptance suite passed" } },
          "Pass release validation",
          ["evidence://validation-release-1"],
        ),
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
    events: [
      {
        schemaVersion: 2,
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
    releasePlan: {
      residualRisk: "A rollback may still be required after deployment",
      intendedExternalAction: "Deploy the approved build to production",
      rollbackCommitment: "Restore the previous immutable release",
    },
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

test("current passing gates move a release-required Mission into human approval", () => {
  const orchestrator = createHarness();
  const releaseBrief = {
    ...validBrief,
    releaseRequired: true,
    releaseAuthorized: true,
    releaseAuthority: "release-owner",
    releasePlan: {
      residualRisk: "A rollback may still be required after deployment",
      intendedExternalAction: "Deploy the approved build to production",
      rollbackCommitment: "Restore the previous immutable release",
    },
  };
  const created = orchestrator.createMission({
    brief: releaseBrief,
    actor: "mission-owner",
    reason: "Start a release Mission that requires human approval",
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
    { context: { summary: "Release Context Pack" } },
    "Capture release Context",
  );
  execute(
    "ACCEPT_PLAN",
    { plan: { steps: ["build", "review", "validate", "approve"] } },
    "Accept release plan",
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
  execute(
    "PASS_REVIEW",
    { review: { summary: "Independent review passed" } },
    "Pass independent review",
    ["evidence://review-release-1"],
  );
  const approvalRequired = execute(
    "PASS_VALIDATION",
    { validation: { summary: "Release acceptance suite passed" } },
    "Pass release validation",
    ["evidence://validation-release-1"],
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
      releaseReadiness: {
        candidate: releaseArtifact(
          "release-candidate-1",
          "artifact://release-candidate-1",
        ),
        candidateArtifacts: [
          releaseArtifact(
            "release-candidate-1",
            "artifact://release-candidate-1",
          ),
        ],
        contextPackVersion: 1,
        evidenceRefs: [
          "evidence://artifact-release-1",
          "evidence://review-release-1",
          "evidence://validation-release-1",
        ],
        residualRisk:
          "A rollback may still be required after deployment",
        intendedExternalAction: "Deploy the approved build to production",
        rollbackCommitment: "Restore the previous immutable release",
      },
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
});

test("release validation fails closed when a candidate has no inspectable detail", () => {
  const orchestrator = createHarness();
  const { created, execute } = createReleaseMissionAtApproval(orchestrator, {
    artifact: {
      name: "opaque-release-candidate",
      uri: "artifact://opaque-release-candidate",
    },
    stopBeforeValidation: true,
  });

  assert.throws(
    () =>
      execute(
        "PASS_VALIDATION",
        { validation: { summary: "Release acceptance suite passed" } },
        "Pass release validation",
        ["evidence://validation-release-1"],
      ),
    /release-required candidate Artifacts must include inline diff, patch, or content before approval/,
  );

  const mission = orchestrator.getMission(created.id);
  assert.equal(mission.status, "VALIDATING");
  assert.equal(mission.events.at(-1).type, "REVIEW_PASSED");

  const referenceOrchestrator = createHarness();
  const { execute: executeReference } = createReleaseMissionAtApproval(
    referenceOrchestrator,
    {
      artifact: {
        name: "reference-only-release-candidate",
        uri: "artifact://reference-only-release-candidate",
        diff: "src/release-candidate.diff",
      },
      stopBeforeValidation: true,
    },
  );
  assert.throws(
    () =>
      executeReference(
        "PASS_VALIDATION",
        { validation: { summary: "Release acceptance suite passed" } },
        "Pass release validation with a reference-only diff",
        ["evidence://validation-release-1"],
      ),
    /release-required candidate Artifacts must include inline diff, patch, or content before approval/,
  );
});

test("passing release gates reject explicit failed outcomes and reused Evidence", () => {
  const reviewOrchestrator = createHarness();
  const { created: reviewMission, execute: executeReview } =
    createReleaseMissionAtApproval(reviewOrchestrator, {
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

  const validationOrchestrator = createHarness();
  const { created: validationMission, execute: executeValidation } =
    createReleaseMissionAtApproval(validationOrchestrator, {
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

  const duplicateOrchestrator = createHarness();
  const { created: duplicateMission, execute: executeDuplicate } =
    createReleaseMissionAtApproval(duplicateOrchestrator, {
      stopBeforeReview: true,
    });
  assert.throws(
    () =>
      executeDuplicate(
        "PASS_REVIEW",
        { review: { summary: "Independent review passed" } },
        "Attempt to reuse Artifact Evidence for review",
        ["evidence://artifact-release-1"],
      ),
    /Evidence refs distinct from earlier release gates/,
  );
  assert.equal(
    duplicateOrchestrator.getMission(duplicateMission.id).status,
    "IN_REVIEW",
  );

  const validationDuplicateOrchestrator = createHarness();
  const {
    created: validationDuplicateMission,
    execute: executeValidationDuplicate,
  } = createReleaseMissionAtApproval(validationDuplicateOrchestrator, {
    stopBeforeValidation: true,
  });
  assert.throws(
    () =>
      executeValidationDuplicate(
        "PASS_VALIDATION",
        { validation: { summary: "Validation passed" } },
        "Attempt to reuse Review Evidence for validation",
        ["evidence://review-release-1"],
      ),
    /Evidence refs distinct from earlier release gates/,
  );
  assert.equal(
    validationDuplicateOrchestrator.getMission(validationDuplicateMission.id)
      .status,
    "VALIDATING",
  );
});

test("authorized human approval records the exact candidate without releasing it", () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore);
  const { created, execute, approvalRequired } =
    createReleaseMissionAtApproval(orchestrator);

  const ready = execute(
    "APPROVE_RELEASE",
    { approval: { summary: "Approve this exact candidate for release" } },
    "Release owner accepts the current residual risk",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );
  const replayed = createHarness(eventStore).getMission(created.id);

  assert.deepEqual(
    {
      status: ready.status,
      approval: ready.approval,
      allowedActions: ready.allowedActions,
      latestEvent: ready.events.at(-1),
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
      approval: {
        decision: "APPROVED",
        summary: "Approve this exact candidate for release",
        candidate: releaseArtifact(
          "release-candidate-1",
          "artifact://release-candidate-1",
        ),
        candidateArtifacts: [
          releaseArtifact(
            "release-candidate-1",
            "artifact://release-candidate-1",
          ),
        ],
        contextPackVersion: 1,
        evidenceRefs: [
          "evidence://artifact-release-1",
          "evidence://review-release-1",
          "evidence://validation-release-1",
        ],
        residualRisk:
          "A rollback may still be required after deployment",
        intendedExternalAction: "Deploy the approved build to production",
        rollbackCommitment: "Restore the previous immutable release",
      },
      allowedActions: [
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEvent: {
        schemaVersion: 2,
        id: "event-8",
        missionId: created.id,
        sequence: 8,
        type: "RELEASE_APPROVED",
        actor: "release-owner",
        occurredAt: "2026-07-28T08:00:00.000Z",
        reason: "Release owner accepts the current residual risk",
        contextPackVersion: 1,
        evidenceRefs: [
          "evidence://artifact-release-1",
          "evidence://review-release-1",
          "evidence://validation-release-1",
        ],
        data: {
          approval: {
            decision: "APPROVED",
            summary: "Approve this exact candidate for release",
            candidate: releaseArtifact(
              "release-candidate-1",
              "artifact://release-candidate-1",
            ),
            candidateArtifacts: [
              releaseArtifact(
                "release-candidate-1",
                "artifact://release-candidate-1",
              ),
            ],
            contextPackVersion: 1,
            evidenceRefs: [
              "evidence://artifact-release-1",
              "evidence://review-release-1",
              "evidence://validation-release-1",
            ],
            residualRisk:
              "A rollback may still be required after deployment",
            intendedExternalAction:
              "Deploy the approved build to production",
            rollbackCommitment: "Restore the previous immutable release",
          },
        },
      },
      emittedExternalAction: false,
      replayedStatus: "READY_TO_RELEASE",
      replayedApproval: {
        decision: "APPROVED",
        summary: "Approve this exact candidate for release",
        candidate: releaseArtifact(
          "release-candidate-1",
          "artifact://release-candidate-1",
        ),
        candidateArtifacts: [
          releaseArtifact(
            "release-candidate-1",
            "artifact://release-candidate-1",
          ),
        ],
        contextPackVersion: 1,
        evidenceRefs: [
          "evidence://artifact-release-1",
          "evidence://review-release-1",
          "evidence://validation-release-1",
        ],
        residualRisk:
          "A rollback may still be required after deployment",
        intendedExternalAction: "Deploy the approved build to production",
        rollbackCommitment: "Restore the previous immutable release",
      },
    },
  );
});

test("release approval snapshots every Artifact in a connected candidate set", async () => {
  const agentRouter = createAgentRoutingAdapter({
    transport: {
      async *run() {
        yield {
          kind: "started",
          runId: "run-release-set",
          occurredAt: "2026-07-30T13:30:00.000Z",
        };
        yield {
          kind: "completed",
          runId: "run-release-set",
          occurredAt: "2026-07-30T13:31:00.000Z",
          summary: "Submitted application and migration Artifacts",
          artifacts: [
            releaseArtifact("application", "artifact://release/application"),
            releaseArtifact("migration", "artifact://release/migration"),
          ],
          evidence: [
            {
              ref: "evidence://release-set",
              kind: "inspection",
              summary: "Both Artifacts inspected",
            },
          ],
        };
      },
    },
  });
  const orchestrator = createHarness(createMemoryEventStore(), agentRouter);
  const created = orchestrator.createMission({
    brief: {
      ...validBrief,
      releaseRequired: true,
      releaseAuthorized: true,
      releaseAuthority: "release-owner",
      releasePlan: {
        residualRisk: "Migration may require rollback",
        intendedExternalAction: "Deploy application and migration together",
        rollbackCommitment: "Restore both previous Artifacts",
      },
    },
    actor: "mission-owner",
    reason: "Create a multi-Artifact release Mission",
  });
  advanceToPlanned(orchestrator, created.id);
  await orchestrator.dispatchAssignment(created.id, {
    assignment: boundedAssignment,
    actor: "mission-owner",
    reason: "Route multi-Artifact release candidate",
  });
  orchestrator.execute(created.id, {
    type: "PASS_REVIEW",
    payload: { review: { summary: "Artifact set reviewed together" } },
    actor: "sol-reviewer",
    reason: "Review the full candidate set",
    evidenceRefs: ["evidence://review-release-set"],
  });
  const approvalRequired = orchestrator.execute(created.id, {
    type: "PASS_VALIDATION",
    payload: { validation: { summary: "Artifact set validated together" } },
    actor: "mission-owner",
    reason: "Validate the full candidate set",
    evidenceRefs: ["evidence://validation-release-set"],
  });
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

test("authorized human rejection returns the exact release candidate for correction", () => {
  const orchestrator = createHarness();
  const { execute, approvalRequired } =
    createReleaseMissionAtApproval(orchestrator);

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
        candidate: releaseArtifact(
          "release-candidate-1",
          "artifact://release-candidate-1",
        ),
        candidateArtifacts: [
          releaseArtifact(
            "release-candidate-1",
            "artifact://release-candidate-1",
          ),
        ],
        contextPackVersion: 1,
        evidenceRefs: [
          "evidence://artifact-release-1",
          "evidence://review-release-1",
          "evidence://validation-release-1",
        ],
        residualRisk:
          "A rollback may still be required after deployment",
        intendedExternalAction: "Deploy the approved build to production",
        rollbackCommitment: "Restore the previous immutable release",
      },
      changeRequest: {
        source: "APPROVAL",
        reason: "Rollback evidence needs more detail",
        evidenceRefs: [
          "evidence://artifact-release-1",
          "evidence://review-release-1",
          "evidence://validation-release-1",
        ],
        requestedAtSequence: 8,
      },
      releaseReadiness: null,
      invalidatedArtifactRefs: ["artifact://release-candidate-1"],
      invalidatedEvidenceRefs: [
        "evidence://artifact-release-1",
        "evidence://review-release-1",
        "evidence://validation-release-1",
      ],
      allowedActions: [
        "start_correction",
        "revise_context",
        "block_mission",
        "cancel_mission",
      ],
      latestEventType: "RELEASE_REJECTED",
    },
  );
});

test("approval correction requires a regenerated candidate and current gate Evidence", () => {
  const orchestrator = createHarness();
  const { execute, approvalRequired } =
    createReleaseMissionAtApproval(orchestrator);
  execute(
    "REJECT_RELEASE",
    { approval: { summary: "Candidate needs a safer rollback plan" } },
    "Reject release candidate v1",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );
  const correction = execute(
    "START_CORRECTION",
    { run: { id: "run-release-2", agentRole: "terra_builder" } },
    "Return approval rejection to the builder",
  );
  execute(
    "SUBMIT_ARTIFACT",
    {
      artifact: releaseArtifact(
        "release-candidate-2",
        "artifact://release-candidate-2",
      ),
    },
    "Submit regenerated release candidate",
    ["evidence://artifact-release-2"],
  );
  execute(
    "PASS_REVIEW",
    { review: { summary: "Candidate v2 review passed" } },
    "Review regenerated candidate",
    ["evidence://review-release-2"],
  );
  const secondApproval = execute(
    "PASS_VALIDATION",
    { validation: { summary: "Candidate v2 validation passed" } },
    "Validate regenerated candidate",
    ["evidence://validation-release-2"],
  );
  const eventCount = secondApproval.events.length;

  assert.throws(
    () =>
      execute(
        "APPROVE_RELEASE",
        { approval: { summary: "Attempt stale approval" } },
        "Attempt to approve with stale gate Evidence",
        approvalRequired.releaseReadiness.evidenceRefs,
        "release-owner",
      ),
    /APPROVE_RELEASE requires current Evidence/,
  );
  assert.deepEqual(
    {
      correctionApproval: correction.approval,
      status: secondApproval.status,
      approval: secondApproval.approval,
      releaseReadiness: secondApproval.releaseReadiness,
      invalidatedArtifactRefs: secondApproval.invalidatedArtifactRefs,
      eventCount: orchestrator.getMission(secondApproval.id).events.length,
    },
    {
      correctionApproval: null,
      status: "APPROVAL_REQUIRED",
      approval: null,
      releaseReadiness: {
        candidate: releaseArtifact(
          "release-candidate-2",
          "artifact://release-candidate-2",
        ),
        candidateArtifacts: [
          releaseArtifact(
            "release-candidate-2",
            "artifact://release-candidate-2",
          ),
        ],
        contextPackVersion: 1,
        evidenceRefs: [
          "evidence://artifact-release-2",
          "evidence://review-release-2",
          "evidence://validation-release-2",
        ],
        residualRisk:
          "A rollback may still be required after deployment",
        intendedExternalAction: "Deploy the approved build to production",
        rollbackCommitment: "Restore the previous immutable release",
      },
      invalidatedArtifactRefs: ["artifact://release-candidate-1"],
      eventCount,
    },
  );
});

test("approval authority and replay fail closed for missing, duplicate, out-of-order, or stale decisions", () => {
  const orchestrator = createHarness();
  const { created, execute, approvalRequired } =
    createReleaseMissionAtApproval(orchestrator);
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
    sequence: 8,
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
      "evidence://validation-release-1",
    ],
  };
  const outOfOrderDecision = {
    ...approvalEvent,
    id: "event-out-of-order-approval",
    sequence: 7,
  };
  const duplicateDecision = {
    ...approvalEvent,
    id: "event-duplicate-approval",
    sequence: 9,
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

test("material Context revision invalidates a recorded release approval", () => {
  const eventStore = createMemoryEventStore();
  const orchestrator = createHarness(eventStore);
  const { created, execute, approvalRequired } =
    createReleaseMissionAtApproval(orchestrator);
  const approved = execute(
    "APPROVE_RELEASE",
    { approval: { summary: "Approve candidate before Context changes" } },
    "Approve the current Context version",
    approvalRequired.releaseReadiness.evidenceRefs,
    "release-owner",
  );
  const revised = execute(
    "REVISE_CONTEXT",
    { context: { summary: "Material release Context v2" } },
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
      invalidatedEvidenceRefs: [
        "evidence://artifact-release-1",
        "evidence://review-release-1",
        "evidence://validation-release-1",
      ],
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
  advanceToPlanned(orchestrator, mission.id);

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
      assignment: boundedAssignment,
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
        context: {
          summary: "Ticket 02 correction-loop Context",
          sourceRefs: ["tickets.md#02"],
        },
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
        schemaVersion: 2,
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
      payload: { context: { summary: "Validation failure Context" } },
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
    { context: { summary: "Repeated correction Context" } },
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
      context: {
        summary: "Context v1",
        sourceRefs: ["context://v1"],
      },
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
      context: {
        summary: "Context v2 includes a material event-store constraint",
        sourceRefs: ["context://v2"],
      },
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
      context: {
        summary: "Context v2 includes a material event-store constraint",
        sourceRefs: ["context://v2"],
      },
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
        schemaVersion: 2,
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
          context: {
            summary: "Context v2 includes a material event-store constraint",
            sourceRefs: ["context://v2"],
          },
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
    { context: { summary: "Block and resume Context" } },
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
    { context: { summary: "Cancellation Context" } },
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
    { context: { summary: "Stale Evidence replay Context" } },
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
      context: {
        summary: "Context for a multi-agent Mission",
        sourceRefs: ["tickets.md#05"],
      },
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
    payload: { context: { summary: "Cycle validation Context" } },
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
    payload: { context: { summary: "Safe-wave Context" } },
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
    payload: { context: { summary: "Decision Room Context" } },
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
    payload: { context: { summary: "Targeted correction Context" } },
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

  const changesRequested = orchestrator.execute(created.id, {
    type: "REJECT_REVIEW",
    payload: {
      review: {
        summary: "Replay loses the owner on one execution error path",
        reviewerAssignmentId: "review-candidate",
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
