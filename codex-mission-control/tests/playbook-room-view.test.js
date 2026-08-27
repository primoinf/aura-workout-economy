import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlaybookActionCommand,
  derivePlaybookRoomModel,
  renderPlaybookRoomContent,
} from "../src/playbook-room-view.js";

const metrics = {
  acceptancePassRate: 0.8,
  criticalRegressions: 0,
  reviewFindings: 4,
  retries: 5,
  cycleTimeMs: 120000,
  tokenUse: 10000,
};

const completeMission = {
  id: "mission-006",
  status: "COMPLETED",
  brief: { goal: "Reduce recurring review failures" },
  allowedActions: [],
};

function fullMission(overrides = {}) {
  const { playbook: playbookOverride, ...missionOverrides } = overrides;
  return {
    ...completeMission,
    ...missionOverrides,
    playbook: {
      status: "PROMOTED",
      retrospective: {
        outcome: "COMPLETED",
        recurringFailurePattern:
          "Review findings recur when retry guidance is absent.",
        evidenceRefs: ["evidence://mission-006/retrospective"],
      },
      baseline: {
        id: "playbook:baseline",
        version: "1",
        evaluationSet: {
          id: "evaluation-set:release",
          version: "2026-08-25",
        },
        metrics,
      },
      candidate: {
        id: "playbook:retry-guidance",
        version: "2",
        basedOn: { id: "playbook:baseline", version: "1" },
        evaluationSet: {
          id: "evaluation-set:release",
          version: "2026-08-25",
        },
        metrics: {
          acceptancePassRate: 0.9,
          criticalRegressions: 0,
          reviewFindings: 2,
          retries: 3,
          cycleTimeMs: 100000,
          tokenUse: 9000,
        },
        change: {
          summary: "Add a bounded retry-evidence checklist to the Playbook.",
        },
      },
      comparison: {
        evaluationSet: {
          id: "evaluation-set:release",
          version: "2026-08-25",
        },
        metrics: {
          acceptancePassRate: { baseline: 0.8, candidate: 0.9, delta: 0.1 },
          criticalRegressions: { baseline: 0, candidate: 0, delta: 0 },
          reviewFindings: { baseline: 4, candidate: 2, delta: -2 },
          retries: { baseline: 5, candidate: 3, delta: -2 },
          cycleTimeMs: { baseline: 120000, candidate: 100000, delta: -20000 },
          tokenUse: { baseline: 10000, candidate: 9000, delta: -1000 },
        },
      },
      declaredTarget: {
        metric: "acceptancePassRate",
        minimumImprovement: 0.05,
      },
      independentReview: {
        decision: "APPROVED",
        reviewer: "sol_reviewer",
        independent: true,
        summary: "The bounded change is safe.",
      },
      humanDecision: {
        decision: "APPROVED",
        actor: "mission-owner",
        summary: "Promote the reviewed candidate.",
      },
      promotedVersions: [
        {
          id: "playbook:retry-guidance@2",
          version: "2",
          candidate: { id: "playbook:retry-guidance" },
        },
      ],
      activePromotedVersionId: "playbook:retry-guidance@2",
      rejectionHistory: [
        {
          candidateId: "playbook:old-guidance",
          reason: "Insufficient target improvement",
        },
      ],
      rollbackHistory: [
        {
          versionId: "playbook:old-guidance@1",
          reason: "Keep the earlier bounded procedure available.",
        },
      ],
      decisionHistory: [
        {
          type: "PROMOTION_REQUESTED",
          actor: "mission-owner",
          summary: "Request independent review.",
        },
        {
          type: "HUMAN_APPROVED",
          actor: "mission-owner",
          summary: "Promote the reviewed candidate.",
        },
      ],
      ...playbookOverride,
    },
  };
}

test("completed Mission without Playbook state renders a safe empty state", () => {
  const model = derivePlaybookRoomModel(completeMission);
  const markup = renderPlaybookRoomContent(model);

  assert.equal(model.empty, true);
  assert.match(markup, /No Playbook Candidate yet/);
  assert.match(markup, /playbook-empty-state/);
  assert.doesNotMatch(markup, /data-playbook-action/);
});

test("completed Mission with the replay-compatible empty Playbook projection renders a safe empty state", () => {
  const model = derivePlaybookRoomModel({
    ...completeMission,
    playbook: {
      status: "NOT_EVALUATED",
      retrospective: null,
      baseline: null,
      candidate: null,
      comparison: null,
      declaredTarget: null,
      independentReview: null,
      humanDecision: null,
      promotedVersions: [],
      rejectionHistory: [],
      rollbackHistory: [],
      decisionHistory: [],
      activePromotedVersionId: null,
    },
    allowedActions: ["evaluate_playbook_candidate"],
  });
  const markup = renderPlaybookRoomContent(model);

  assert.equal(model.empty, true);
  assert.match(markup, /No Playbook Candidate yet/);
  assert.match(markup, /data-playbook-action="evaluate_playbook_candidate"/);
});

test("Playbook Room model exposes the fixed evaluation set and all six comparison metrics", () => {
  const model = derivePlaybookRoomModel(fullMission());

  assert.equal(model.empty, false);
  assert.equal(model.status, "PROMOTED");
  assert.deepEqual(model.evaluationSet, {
    id: "evaluation-set:release",
    version: "2026-08-25",
  });
  assert.deepEqual(
    model.metrics.map((metric) => metric.key),
    [
      "acceptancePassRate",
      "criticalRegressions",
      "reviewFindings",
      "retries",
      "cycleTimeMs",
      "tokenUse",
    ],
  );
  assert.deepEqual(
    model.metrics.find((metric) => metric.key === "acceptancePassRate"),
    {
      key: "acceptancePassRate",
      label: "Acceptance pass rate",
      unit: "%",
      baseline: 0.8,
      candidate: 0.9,
      delta: 0.1,
    },
  );
});

test("Playbook Room target gate projects the declared non-default metric", () => {
  const model = derivePlaybookRoomModel(
    fullMission({
      playbook: {
        declaredTarget: { metric: "retries", minimumImprovement: 1 },
      },
    }),
  );

  assert.deepEqual(model.gates.target, {
    status: "RECORDED",
    summary: null,
    baseline: 5,
    candidate: 3,
    delta: -2,
  });
  const markup = renderPlaybookRoomContent(model);
  assert.match(markup, /Target gate/);
  assert.match(markup, /Target comparison: Baseline 5 count; Candidate 3 count; Delta -2 count/);
});

test("Playbook Room markup renders metrics, retrospective Evidence, gates, and immutable histories", () => {
  const markup = renderPlaybookRoomContent(
    derivePlaybookRoomModel(fullMission()),
  );

  assert.match(markup, /Candidate vs Baseline/);
  assert.match(markup, /evaluation-set:release/);
  assert.match(markup, /2026-08-25/);
  assert.match(markup, /playbook:baseline/);
  assert.match(markup, /playbook:retry-guidance/);
  assert.match(markup, /Acceptance pass rate/);
  assert.match(markup, /80%/);
  assert.match(markup, /90%/);
  assert.match(markup, /120,000 ms/);
  assert.match(markup, /10,000 tokens/);
  assert.match(markup, /Review findings recur when retry guidance is absent/);
  assert.match(markup, /evidence:\/\/mission-006\/retrospective/);
  assert.match(markup, /Critical regression gate/);
  assert.match(markup, /Declared target/);
  assert.match(markup, /Independent review/);
  assert.match(markup, /Human approval/);
  assert.match(markup, /playbook:retry-guidance@2/);
  assert.match(markup, /Insufficient target improvement/);
  assert.match(markup, /Keep the earlier bounded procedure available/);
  assert.match(markup, /PROMOTION_REQUESTED/);
});

test("Playbook Room renders only actions present in the projected Mission allowedActions", () => {
  const markup = renderPlaybookRoomContent(
    derivePlaybookRoomModel(
      fullMission({
        allowedActions: [
          "approve_playbook_promotion",
          "rollback_playbook_version",
          "cancel_mission",
        ],
      }),
    ),
  );

  assert.match(markup, /data-playbook-action="approve_playbook_promotion"/);
  assert.match(markup, /data-playbook-action="rollback_playbook_version"/);
  assert.doesNotMatch(markup, /data-playbook-action="reject_playbook_candidate"/);
  assert.doesNotMatch(markup, /data-playbook-action="cancel_mission"/);
});

test("Playbook Room recognizes the exact rejection and rollback actions projected by the Orchestrator", () => {
  const markup = renderPlaybookRoomContent(
    derivePlaybookRoomModel(
      fullMission({
        allowedActions: [
          "reject_playbook_candidate",
          "rollback_playbook_version",
        ],
      }),
    ),
  );

  assert.match(markup, /data-playbook-action="reject_playbook_candidate"/);
  assert.match(markup, /data-playbook-action="rollback_playbook_version"/);
});

test("Playbook Room controls are semantic and labelled", () => {
  const markup = renderPlaybookRoomContent(
    derivePlaybookRoomModel(
      fullMission({
        allowedActions: [
          "approve_playbook_promotion",
          "reject_playbook_candidate",
        ],
      }),
    ),
  );

  assert.match(markup, /aria-labelledby="playbook-title"/);
  assert.match(markup, /aria-label="Allowed Playbook actions"/);
  assert.match(markup, /<button[^>]+type="button"[^>]+data-playbook-action="approve_playbook_promotion"/);
  assert.match(markup, /Approve Playbook promotion/);
  assert.match(markup, /Reject Playbook candidate/);
  assert.match(markup, /<table[^>]+aria-label="Candidate and Baseline metrics"/);
  assert.match(markup, /<th scope="row">Acceptance pass rate<\/th>/);
});

test("Playbook Room builds explicit human decision commands without inventing reviewer Evidence", () => {
  assert.deepEqual(
    buildPlaybookActionCommand("reject_playbook_candidate", {
      actor: "release-captain",
      rationale: "Keep the current baseline until the retry evidence improves.",
    }),
    {
      type: "REJECT_PLAYBOOK_CANDIDATE",
      payload: {
        rejection: {
          rationale: "Keep the current baseline until the retry evidence improves.",
        },
      },
      actor: "release-captain",
      reason: "Mission owner rejected the Playbook Candidate",
      evidenceRefs: [],
    },
  );
  assert.deepEqual(
    buildPlaybookActionCommand("rollback_playbook_version", {
      actor: "release-captain",
      rationale: "Observed results no longer match the fixed evaluation set.",
    }),
    {
      type: "ROLLBACK_PLAYBOOK_VERSION",
      payload: {
        rollback: {
          rationale: "Observed results no longer match the fixed evaluation set.",
        },
      },
      actor: "release-captain",
      reason: "Mission owner rolled back the active Playbook version",
      evidenceRefs: [],
    },
  );
  assert.throws(
    () =>
      buildPlaybookActionCommand("record_playbook_independent_review", {
        rationale: "Pretend this came from a reviewer.",
      }),
    /transport-backed Sol Reviewer dispatch/,
  );
});

test("Playbook Room escapes user-controlled Mission and decision text", () => {
  const markup = renderPlaybookRoomContent(
    derivePlaybookRoomModel(
      fullMission({
        brief: { goal: '<script>alert("goal")</script>' },
        playbook: {
          ...fullMission().playbook,
          retrospective: {
            ...fullMission().playbook.retrospective,
            recurringFailurePattern: '<img src=x onerror="bad">',
          },
          humanDecision: {
            decision: "APPROVED",
            actor: "owner<&",
            summary: "Use <the> bounded candidate",
          },
        },
      }),
    ),
  );

  assert.doesNotMatch(markup, /<script>alert/);
  assert.match(markup, /&lt;script&gt;alert\(&quot;goal&quot;\)&lt;\/script&gt;/);
  assert.match(markup, /&lt;img src=x onerror=&quot;bad&quot;&gt;/);
  assert.match(markup, /Use &lt;the&gt; bounded candidate/);
  assert.match(markup, /owner&lt;&amp;/);
});
