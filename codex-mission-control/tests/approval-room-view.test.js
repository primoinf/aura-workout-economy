import assert from "node:assert/strict";
import test from "node:test";

import {
  buildApprovalDecisionCommand,
  renderApprovalRoomContent,
} from "../src/approval-room-view.js";

const model = {
  missionId: "mission-release",
  goal: "Ship the audited release",
  status: "APPROVAL_REQUIRED",
  candidate: {
    name: "release-42",
    uri: "artifact://release-42",
  },
  candidateArtifacts: [
    {
      name: "release-42",
      uri: "artifact://release-42",
      summary: "The exact bounded release candidate",
      diff: "@@ -1 +1 @@\n-old\n+new",
    },
  ],
  evidence: ["evidence://artifact-42"],
  evidenceDetails: [
    {
      ref: "evidence://artifact-42",
      kind: "inspection",
      summary: "Artifact inspection passed",
      sourceEventType: "AGENT_RUN_COMPLETED",
      sourceSequence: 6,
      details: { checks: ["artifact exists", "diff captured"] },
    },
  ],
  contextPackVersion: 2,
  residualRisk: "A failed rollout may require rollback",
  intendedExternalAction: "Deploy only release-42",
  rollbackCommitment: "Restore release-41",
  releaseAuthority: "release-owner",
  canApprove: true,
  canReject: true,
  decisionHistory: [],
};

test("Approval Room markup exposes exact artifact details, evidence details, and decision controls", () => {
  const markup = renderApprovalRoomContent(model);

  assert.match(markup, /EXACT CANDIDATE/);
  assert.match(markup, /artifact:\/\/release-42/);
  assert.match(markup, /The exact bounded release candidate/);
  assert.match(markup, /@@ -1 \+1 @@/);
  assert.match(markup, /Artifact inspection passed/);
  assert.match(markup, /artifact exists/);
  assert.match(markup, /RESIDUAL RISK/);
  assert.match(markup, /Deploy only release-42/);
  assert.match(markup, /approval-decision-form/);
  assert.match(markup, /value="reject"/);
  assert.match(markup, /value="approve"/);
});

test("Approval Room markup keeps approved history immutable and removes decision controls", () => {
  const markup = renderApprovalRoomContent({
    ...model,
    status: "READY_TO_RELEASE",
    canApprove: false,
    canReject: false,
    decisionHistory: [
      {
        sequence: 8,
        type: "RELEASE_APPROVED",
        actor: "release-owner",
        reason: "Accept current residual risk",
        occurredAt: "2026-08-04T12:00:00.000Z",
        summary: "Approve release-42",
      },
    ],
  });

  assert.match(markup, /Release readiness recorded/);
  assert.match(markup, /Decision is immutable/);
  assert.match(markup, /Approve release-42/);
  assert.doesNotMatch(markup, /approval-decision-form/);
});

test("Approval Room keeps a rejected candidate snapshot inspectable", () => {
  const markup = renderApprovalRoomContent({
    ...model,
    status: "CHANGES_REQUESTED",
    decision: "REJECTED",
    canApprove: false,
    canReject: false,
    decisionHistory: [
      {
        sequence: 8,
        type: "RELEASE_REJECTED",
        actor: "release-owner",
        reason: "Rollback evidence needs more detail",
        occurredAt: "2026-08-04T12:00:00.000Z",
        summary: "Regenerate release-42 with a clearer rollback proof",
      },
    ],
  });

  assert.match(markup, /Release changes requested/);
  assert.match(markup, /Regenerate release-42 with a clearer rollback proof/);
  assert.match(markup, /Changes requested—not released/);
  assert.doesNotMatch(markup, /approval-decision-form/);
});

test("Approval Room fails closed when a candidate detail is missing", () => {
  const markup = renderApprovalRoomContent({
    ...model,
    candidateArtifacts: [{ name: "opaque", uri: "artifact://opaque" }],
  });

  assert.match(markup, /Release evidence incomplete/);
  assert.match(markup, /Decision unavailable/);
  assert.doesNotMatch(markup, /approval-decision-form/);
});

test("Approval Room renders the first usable patch or content detail", () => {
  const patchMarkup = renderApprovalRoomContent({
    ...model,
    candidateArtifacts: [
      {
        name: "patched",
        uri: "artifact://patched",
        diff: "   ",
        patch: "@@ patch is the exact candidate @@",
      },
    ],
  });
  assert.match(patchMarkup, /@@ patch is the exact candidate @@/);
  assert.doesNotMatch(patchMarkup, /No inline diff supplied/);
  assert.match(patchMarkup, /approval-decision-form/);

  const contentMarkup = renderApprovalRoomContent({
    ...model,
    candidateArtifacts: [
      {
        name: "content-only",
        uri: "artifact://content-only",
        content: "exact inline content",
      },
    ],
  });
  assert.match(contentMarkup, /Artifact content/);
  assert.match(contentMarkup, /exact inline content/);
  assert.doesNotMatch(contentMarkup, /No inline diff supplied/);

  const referenceMarkup = renderApprovalRoomContent({
    ...model,
    candidateArtifacts: [
      {
        name: "reference-only",
        uri: "artifact://reference-only",
        content: "src/release-candidate.diff",
      },
    ],
  });
  assert.match(referenceMarkup, /Decision unavailable/);
  assert.doesNotMatch(referenceMarkup, /approval-decision-form/);

  const metadataOnlyMarkup = renderApprovalRoomContent({
    ...model,
    candidateArtifacts: [
      {
        name: "metadata-only",
        uri: "artifact://metadata-only",
        content: {
          uri: "artifact://blob",
          mimeType: "text/plain",
          sha256: "abc123",
        },
      },
    ],
  });
  assert.match(metadataOnlyMarkup, /Decision unavailable/);
  assert.doesNotMatch(metadataOnlyMarkup, /approval-decision-form/);
});

test("approval decision command preserves the current candidate Evidence and authority", () => {
  const mission = {
    id: model.missionId,
    brief: { releaseAuthority: model.releaseAuthority },
    releaseReadiness: {
      candidate: model.candidateArtifacts[0],
      candidateArtifacts: model.candidateArtifacts,
      evidenceRefs: model.evidence,
    },
  };

  assert.deepEqual(
    buildApprovalDecisionCommand(mission, {
      decision: "approve",
      summary: "Approve the inspected release-42 candidate",
    }),
    {
      type: "APPROVE_RELEASE",
      payload: {
        approval: {
          summary: "Approve the inspected release-42 candidate",
        },
      },
      actor: "release-owner",
      reason: "Release authority approved the exact current candidate",
      evidenceRefs: ["evidence://artifact-42"],
    },
  );

  assert.throws(
    () =>
      buildApprovalDecisionCommand(mission, {
        decision: "hold",
        summary: "No decision",
      }),
    /Choose approve or reject/,
  );

  assert.throws(
    () =>
      buildApprovalDecisionCommand(
        {
          ...mission,
          releaseReadiness: {
            ...mission.releaseReadiness,
            candidateArtifacts: [{ name: "opaque", uri: "artifact://opaque" }],
          },
        },
        { decision: "approve", summary: "Approve opaque candidate" },
      ),
    /inspectable diff, patch, or content/,
  );
});
