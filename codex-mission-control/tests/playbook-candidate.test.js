import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlaybookCandidate,
  dispatchPlaybookIndependentReview,
  promotePlaybookCandidate,
  recordIndependentPlaybookReview,
  recordRejectedPlaybookIndependentReview,
  rejectPlaybookCandidate,
  rollbackPlaybookCandidate,
  requestPlaybookPromotion,
} from "../src/playbook-candidate.js";

function playbookCandidateInput() {
  const evaluationSet = {
    id: "evaluation-set:release",
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
      id: "retrospective:mission-006",
      version: "1",
      missionId: "mission-006",
      outcome: "COMPLETED",
      recurringFailurePattern: "Review findings recur when retry guidance is absent.",
      metrics: structuredClone(baselineMetrics),
      evidenceRefs: ["evidence://mission-006/retrospective"],
    },
    baseline: {
      id: "playbook:baseline",
      version: "1",
      evaluationSet: structuredClone(evaluationSet),
      protectedConfiguration,
      metrics: structuredClone(baselineMetrics),
      criticalRegressionCaseIds: [],
    },
    candidate: {
      id: "playbook:retry-guidance",
      version: "2",
      basedOn: { id: "playbook:baseline", version: "1" },
      evaluationSet: structuredClone(evaluationSet),
      protectedConfiguration,
      change: {
        summary: "Add a bounded retry-evidence checklist to the Playbook.",
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
    },
    declaredTarget: {
      metric: "acceptancePassRate",
      minimumImprovement: 0.05,
    },
  };
}

function approvedReviewPayload(
  state,
  decidedAt = "2026-08-25T09:05:00.000Z",
) {
  return {
    dispatchId: state.reviewDispatch.id,
    decision: "APPROVED",
    reviewer: "sol_reviewer",
    actor: "agent:sol_reviewer",
    independent: true,
    effectivePermission: "read-only",
    candidateId: state.candidate.id,
    candidateVersion: state.candidate.version,
    baseline: {
      id: state.baseline.id,
      version: state.baseline.version,
    },
    evaluationSet: structuredClone(state.candidate.evaluationSet),
    evidenceRefs: ["evidence://playbook-independent-review"],
    findings: [],
    rationale: "The current comparison has no new critical regression.",
    decidedAt,
  };
}

function playbookReviewDispatchPayload(
  state,
  dispatchedAt = "2026-08-25T09:04:00.000Z",
) {
  return {
    id: `playbook-review:${state.candidate.id}@${state.candidate.version}`,
    candidateId: state.candidate.id,
    candidateVersion: state.candidate.version,
    baseline: {
      id: state.baseline.id,
      version: state.baseline.version,
    },
    evaluationSet: structuredClone(state.candidate.evaluationSet),
    dispatchedAt,
  };
}

function dispatchIndependentReview(
  state,
  dispatchedAt = "2026-08-25T09:04:00.000Z",
) {
  return dispatchPlaybookIndependentReview(
    state,
    playbookReviewDispatchPayload(state, dispatchedAt),
  );
}

function rejectedReviewPayload(
  state,
  decidedAt = "2026-08-25T09:05:00.000Z",
) {
  return {
    ...approvedReviewPayload(state, decidedAt),
    decision: "REJECTED",
    findings: ["The retry outcome has no traceable production evidence."],
    rationale: "The independent reviewer found unresolved evidence gaps.",
  };
}

function recordRejectedIndependentReview(
  state,
  decidedAt = "2026-08-25T09:05:00.000Z",
) {
  return recordRejectedPlaybookIndependentReview(
    state,
    rejectedReviewPayload(state, decidedAt),
  );
}

function recordApprovedReview(state, decidedAt = "2026-08-25T09:05:00.000Z") {
  const dispatched = dispatchIndependentReview(state);
  return recordIndependentPlaybookReview(
    dispatched,
    approvedReviewPayload(dispatched, decidedAt),
  );
}

test("a candidate with the declared improvement and both approvals promotes an immutable version", () => {
  const candidate = createPlaybookCandidate(playbookCandidateInput());
  const requested = requestPlaybookPromotion(candidate, {
    actor: "mission-owner",
    decidedAt: "2026-08-25T09:00:00.000Z",
  });
  const reviewed = recordApprovedReview(requested);
  const promoted = promotePlaybookCandidate(reviewed, {
    independentReview: reviewed.independentReview,
    humanDecision: {
      decision: "APPROVED",
      actor: "mission-owner",
      rationale: "The reviewed evaluation proves the declared improvement.",
      decidedAt: "2026-08-25T09:06:00.000Z",
    },
  });

  assert.equal(promoted.status, "PROMOTED");
  assert.equal(promoted.promotedVersions.length, 2);
  assert.equal(promoted.promotedVersions[0].version, "1");
  assert.equal(promoted.promotedVersions[1].version, "2");
  assert.equal(promoted.activePromotedVersionId, "playbook:retry-guidance@2");
  assert.equal(promoted.comparison.metrics.acceptancePassRate.delta, 0.1);
  assert.deepEqual(
    promoted.decisionHistory.map((entry) => entry.type),
    [
      "PROMOTION_REQUESTED",
      "INDEPENDENT_REVIEW_DISPATCHED",
      "INDEPENDENT_REVIEW_APPROVED",
      "HUMAN_APPROVED",
    ],
  );
  assert.equal(Object.isFrozen(promoted), true);
  assert.equal(Object.isFrozen(promoted.promotedVersions[0]), true);
  assert.equal(Object.isFrozen(promoted.promotedVersions[1]), true);
});

test("promotion cannot bypass the recorded independent reviewer decision", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T09:07:00.000Z",
    },
  );

  assert.throws(
    () =>
      promotePlaybookCandidate(requested, {
        independentReview: {
          decision: "APPROVED",
          reviewer: "sol_reviewer",
          independent: true,
          effectivePermission: "read-only",
        },
        humanDecision: {
          decision: "APPROVED",
          actor: "mission-owner",
          rationale: "The review must be recorded before approval.",
        },
      }),
    /current recorded independent reviewer decision/,
  );
  assert.equal(requested.status, "PROMOTION_REQUESTED");
});

test("independent review records require a Sol Reviewer actor and Evidence", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T09:08:00.000Z",
    },
  );
  const dispatched = dispatchIndependentReview(requested);
  const review = {
    dispatchId: dispatched.reviewDispatch.id,
    decision: "APPROVED",
    reviewer: "sol_reviewer",
    independent: true,
    effectivePermission: "read-only",
    candidateId: dispatched.candidate.id,
    candidateVersion: dispatched.candidate.version,
    baseline: {
      id: dispatched.baseline.id,
      version: dispatched.baseline.version,
    },
    evaluationSet: structuredClone(dispatched.candidate.evaluationSet),
    findings: [],
    rationale: "The current comparison has no new critical regression.",
  };

  assert.throws(
    () => recordIndependentPlaybookReview(dispatched, review),
    /actor agent:sol_reviewer and at least one Evidence reference/,
  );
  assert.equal(dispatched.status, "REVIEW_IN_PROGRESS");
});

test("a human rejection preserves the candidate snapshot and appends rejection history", () => {
  const candidate = createPlaybookCandidate(playbookCandidateInput());
  const rejected = rejectPlaybookCandidate(candidate, {
    decision: "REJECTED",
    actor: "mission-owner",
    rationale: "Keep the current retry procedure for this release.",
    decidedAt: "2026-08-25T09:10:00.000Z",
  });

  assert.equal(rejected.status, "REJECTED");
  assert.deepEqual(rejected.candidate, candidate.candidate);
  assert.deepEqual(rejected.promotedVersions, []);
  assert.deepEqual(rejected.rejectionHistory, [
    {
      candidateId: "playbook:retry-guidance",
      candidateVersion: "2",
      decision: "REJECTED",
      actor: "mission-owner",
      rationale: "Keep the current retry procedure for this release.",
      decidedAt: "2026-08-25T09:10:00.000Z",
    },
  ]);
  assert.deepEqual(rejected.decisionHistory.map((entry) => entry.type), [
    "HUMAN_REJECTED",
  ]);
  assert.equal(Object.isFrozen(rejected.rejectionHistory), true);
});

test("a new critical regression blocks a promotion request", () => {
  const input = playbookCandidateInput();
  input.candidate.metrics.criticalRegressions = 1;
  input.candidate.criticalRegressionCaseIds = ["case:review-handoff"];
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:15:00.000Z",
      }),
    /new critical regression/,
  );
  assert.equal(candidate.status, "EVALUATED");
  assert.deepEqual(candidate.decisionHistory, []);
});

test("a newly introduced critical regression case blocks promotion even when aggregate counts match", () => {
  const input = playbookCandidateInput();
  input.baseline.metrics.criticalRegressions = 1;
  input.baseline.criticalRegressionCaseIds = ["case:retry-evidence"];
  input.candidate.metrics.criticalRegressions = 1;
  input.candidate.criticalRegressionCaseIds = ["case:review-handoff"];
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:16:00.000Z",
      }),
    /new critical regression/,
  );
  assert.equal(candidate.status, "EVALUATED");
});

test("a candidate that misses its declared target improvement cannot request promotion", () => {
  const input = playbookCandidateInput();
  input.candidate.metrics.acceptancePassRate = 0.84;
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:20:00.000Z",
      }),
    /does not achieve its declared target improvement/,
  );
  assert.equal(candidate.status, "EVALUATED");
});

test("a candidate without a declared target improvement cannot request promotion", () => {
  const input = playbookCandidateInput();
  delete input.declaredTarget;
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:25:00.000Z",
      }),
    /requires a declared target improvement/,
  );
});

test("a promotion request requires a supported metric and positive declared improvement", () => {
  const invalidTargets = [
    { metric: "untrackedMetric", minimumImprovement: 0.05 },
    { metric: "acceptancePassRate", minimumImprovement: 0 },
    { metric: "acceptancePassRate", minimumImprovement: Number.NaN },
  ];

  for (const declaredTarget of invalidTargets) {
    const input = playbookCandidateInput();
    input.declaredTarget = declaredTarget;
    const candidate = createPlaybookCandidate(input);

    assert.throws(
      () =>
        requestPlaybookPromotion(candidate, {
          actor: "mission-owner",
          decidedAt: "2026-08-25T09:26:00.000Z",
        }),
      /supported metric with a positive finite minimum improvement/,
    );
    assert.equal(candidate.status, "EVALUATED");
  }
});

test("a candidate based on a stale baseline cannot request promotion", () => {
  const input = playbookCandidateInput();
  input.candidate.basedOn.version = "0";
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:30:00.000Z",
      }),
    /stale baseline/,
  );
});

test("a candidate evaluated on a different evaluation-set version cannot request promotion", () => {
  const input = playbookCandidateInput();
  input.candidate.evaluationSet.version = "2026-08-26";
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:35:00.000Z",
      }),
    /same versioned evaluation set/,
  );
});

test("a candidate evaluated on different case identities cannot request promotion", () => {
  const input = playbookCandidateInput();
  input.candidate.evaluationSet = structuredClone(input.candidate.evaluationSet);
  input.candidate.evaluationSet.caseIds[1] = "case:unreviewed-handoff";
  const candidate = createPlaybookCandidate(input);

  assert.throws(
    () =>
      requestPlaybookPromotion(candidate, {
        actor: "mission-owner",
        decidedAt: "2026-08-25T09:36:00.000Z",
      }),
    /same versioned evaluation cases/,
  );
});

test("candidate evaluation rejects invalid comparison metrics", () => {
  const invalidMetrics = [
    ["candidate", "tokenUse", -1, /Candidate metrics tokenUse must be finite and non-negative/],
    ["baseline", "acceptancePassRate", 1.1, /Baseline metrics acceptancePassRate must be from 0 to 1/],
    ["retrospective", "criticalRegressions", -1, /Retrospective metrics criticalRegressions must be finite and non-negative/],
  ];

  for (const [subject, metric, value, error] of invalidMetrics) {
    const input = playbookCandidateInput();
    input[subject].metrics[metric] = value;

    assert.throws(() => createPlaybookCandidate(input), error);
  }
});

test("candidate evaluation requires bounded retrospective Evidence and versioned case identities", () => {
  const mutations = [
    [
      (input) => {
        input.retrospective.outcome = "";
      },
      /outcome/,
    ],
    [
      (input) => {
        input.retrospective.recurringFailurePattern = "";
      },
      /recurring failure pattern/,
    ],
    [
      (input) => {
        input.retrospective.evidenceRefs = [];
      },
      /at least one Evidence reference/,
    ],
    [
      (input) => {
        input.baseline.evaluationSet.version = "";
      },
      /versioned evaluation set/,
    ],
    [
      (input) => {
        input.candidate.evaluationSet.caseIds = [];
      },
      /at least one evaluation case/,
    ],
  ];

  for (const [mutate, expectedError] of mutations) {
    const input = playbookCandidateInput();
    mutate(input);
    assert.throws(() => createPlaybookCandidate(input), expectedError);
  }
});

test("candidate evaluation requires immutable version identities and protected configuration", () => {
  const mutations = [
    [
      (input) => {
        input.retrospective.id = "";
      },
      /Retrospective id/,
    ],
    [
      (input) => {
        input.baseline.version = "";
      },
      /Baseline version/,
    ],
    [
      (input) => {
        input.candidate.id = "";
      },
      /Candidate id/,
    ],
    [
      (input) => {
        input.candidate.basedOn.version = "";
      },
      /Candidate basedOn version/,
    ],
    [
      (input) => {
        input.candidate.protectedConfiguration = [];
      },
      /Candidate protected configuration/,
    ],
  ];

  for (const [mutate, expectedError] of mutations) {
    const input = playbookCandidateInput();
    mutate(input);
    assert.throws(() => createPlaybookCandidate(input), expectedError);
  }
});

test("candidate evaluation validates critical regression case provenance", () => {
  const mutations = [
    [
      (input) => {
        input.baseline.metrics.criticalRegressions = 2;
        input.baseline.criticalRegressionCaseIds = [
          "case:retry-evidence",
          "case:retry-evidence",
        ];
      },
      /Baseline critical regression case IDs/,
    ],
    [
      (input) => {
        input.candidate.metrics.criticalRegressions = 1;
        input.candidate.criticalRegressionCaseIds = ["case:outside-set"];
      },
      /Candidate critical regression case IDs/,
    ],
    [
      (input) => {
        input.candidate.criticalRegressionCaseIds = ["case:retry-evidence"];
      },
      /Candidate critical regression case IDs must match criticalRegressions/,
    ],
  ];

  for (const [mutate, expectedError] of mutations) {
    const input = playbookCandidateInput();
    mutate(input);
    assert.throws(() => createPlaybookCandidate(input), expectedError);
  }
});

test("a lower-is-better declared target treats a retry reduction as improvement", () => {
  const input = playbookCandidateInput();
  input.declaredTarget = {
    metric: "retries",
    minimumImprovement: 1,
  };
  input.candidate.metrics.retries = 3;
  const candidate = createPlaybookCandidate(input);

  const requested = requestPlaybookPromotion(candidate, {
    actor: "mission-owner",
    decidedAt: "2026-08-25T09:37:00.000Z",
  });

  assert.equal(requested.status, "PROMOTION_REQUESTED");
  assert.equal(requested.comparison.metrics.retries.improvement, 2);
});

test("promotion requires an independently approved review", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T09:40:00.000Z",
    },
  );

  assert.throws(
    () =>
      promotePlaybookCandidate(requested, {
        humanDecision: {
          decision: "APPROVED",
          actor: "mission-owner",
          rationale: "Promotion cannot proceed without an independent review.",
          decidedAt: "2026-08-25T09:41:00.000Z",
        },
      }),
    /current recorded independent reviewer decision/,
  );
  assert.equal(requested.status, "PROMOTION_REQUESTED");
});

test("independent reviews require a rationale and an explicit findings list", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T09:43:00.000Z",
    },
  );
  const dispatched = dispatchIndependentReview(requested);

  const missingRationale = approvedReviewPayload(dispatched);
  missingRationale.rationale = " ";
  assert.throws(
    () => recordIndependentPlaybookReview(dispatched, missingRationale),
    /rationale and findings/,
  );

  const missingFindings = approvedReviewPayload(dispatched);
  delete missingFindings.findings;
  assert.throws(
    () => recordIndependentPlaybookReview(dispatched, missingFindings),
    /rationale and findings/,
  );
});

test("promotion requires an explicit human approval", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T09:45:00.000Z",
    },
  );
  const reviewed = recordApprovedReview(requested, "2026-08-25T09:46:00.000Z");

  assert.throws(
    () =>
      promotePlaybookCandidate(reviewed, {
        independentReview: reviewed.independentReview,
      }),
    /explicit human approval/,
  );
  assert.equal(requested.status, "PROMOTION_REQUESTED");
});

test("a promoted version preserves an immutable retrospective evidence snapshot", () => {
  const input = playbookCandidateInput();
  const candidate = createPlaybookCandidate(input);
  input.retrospective.evidenceRefs[0] = "evidence://rewritten-by-caller";
  input.candidate.change.summary = "A caller-side rewrite";
  const requested = requestPlaybookPromotion(candidate, {
    actor: "mission-owner",
    decidedAt: "2026-08-25T09:50:00.000Z",
  });
  const reviewed = recordApprovedReview(requested, "2026-08-25T09:51:00.000Z");
  const promoted = promotePlaybookCandidate(reviewed, {
    independentReview: reviewed.independentReview,
    humanDecision: {
      decision: "APPROVED",
      actor: "mission-owner",
      rationale: "The snapshot preserves the approved retrospective evidence.",
      decidedAt: "2026-08-25T09:52:00.000Z",
    },
  });

  assert.deepEqual(promoted.promotedVersions[1].retrospective, {
    id: "retrospective:mission-006",
    version: "1",
    missionId: "mission-006",
    outcome: "COMPLETED",
    recurringFailurePattern:
      "Review findings recur when retry guidance is absent.",
    metrics: {
      acceptancePassRate: 0.8,
      criticalRegressions: 0,
      reviewFindings: 4,
      retries: 5,
      cycleTimeMs: 120000,
      tokenUse: 10000,
    },
    evidenceRefs: ["evidence://mission-006/retrospective"],
  });
  assert.equal(
    promoted.promotedVersions[1].candidate.change.summary,
    "Add a bounded retry-evidence checklist to the Playbook.",
  );
  assert.equal(
    Object.isFrozen(promoted.promotedVersions[1].retrospective.evidenceRefs),
    true,
  );
});

test("rollback preserves the promoted version and appends its human decision", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:00:00.000Z",
    },
  );
  const reviewed = recordApprovedReview(requested, "2026-08-25T10:01:00.000Z");
  const promoted = promotePlaybookCandidate(reviewed, {
    independentReview: reviewed.independentReview,
    humanDecision: {
      decision: "APPROVED",
      actor: "mission-owner",
      rationale: "The reviewed candidate should become the active version.",
      decidedAt: "2026-08-25T10:02:00.000Z",
    },
  });
  const versionsBeforeRollback = structuredClone(promoted.promotedVersions);

  const rolledBack = rollbackPlaybookCandidate(promoted, {
    decision: "ROLLED_BACK",
    actor: "mission-owner",
    rationale: "The production retry signal no longer matches the evaluation set.",
    decidedAt: "2026-08-25T10:03:00.000Z",
  });

  assert.equal(rolledBack.status, "ROLLED_BACK");
  assert.equal(rolledBack.activePromotedVersionId, "playbook:baseline@1");
  assert.deepEqual(rolledBack.promotedVersions, versionsBeforeRollback);
  assert.deepEqual(rolledBack.rollbackHistory, [
    {
      versionId: "playbook:retry-guidance@2",
      fromVersionId: "playbook:retry-guidance@2",
      toVersionId: "playbook:baseline@1",
      candidateId: "playbook:retry-guidance",
      candidateVersion: "2",
      decision: "ROLLED_BACK",
      actor: "mission-owner",
      rationale: "The production retry signal no longer matches the evaluation set.",
      decidedAt: "2026-08-25T10:03:00.000Z",
    },
  ]);
  assert.deepEqual(rolledBack.decisionHistory.map((entry) => entry.type), [
    "PROMOTION_REQUESTED",
    "INDEPENDENT_REVIEW_DISPATCHED",
    "INDEPENDENT_REVIEW_APPROVED",
    "HUMAN_APPROVED",
    "HUMAN_ROLLED_BACK",
  ]);
  assert.equal(promoted.status, "PROMOTED");
});

test("rollback rejects an unpromoted candidate without creating history", () => {
  const evaluated = createPlaybookCandidate(playbookCandidateInput());

  assert.throws(
    () =>
      rollbackPlaybookCandidate(evaluated, {
        decision: "ROLLED_BACK",
        actor: "mission-owner",
        rationale: "There is no active version to roll back.",
      }),
    /active promoted Playbook version/,
  );
  assert.equal(evaluated.status, "EVALUATED");
  assert.deepEqual(evaluated.rollbackHistory, []);
});

test("promotion requests reject protected prompt, profile, or security-policy rewrites without mutating input", () => {
  const changes = [
    ["systemPrompts", { missionPolicy: "Permit unbounded execution." }],
    ["agentProfiles", { reviewer: "unreviewed-agent" }],
    ["securityPolicy", { releaseRequiresHumanApproval: false }],
  ];

  for (const [field, value] of changes) {
    const input = playbookCandidateInput();
    input.candidate.protectedConfiguration = structuredClone(
      input.candidate.protectedConfiguration,
    );
    input.candidate.protectedConfiguration[field] = value;
    const inputBeforeEvaluation = structuredClone(input);
    const candidate = createPlaybookCandidate(input);

    assert.throws(
      () =>
        requestPlaybookPromotion(candidate, {
          actor: "mission-owner",
          decidedAt: "2026-08-25T10:10:00.000Z",
        }),
      /protected prompts, agent profiles, or security policy/,
    );
    assert.deepEqual(input, inputBeforeEvaluation);
  }
});

test("human decisions require the authorized actor and a durable rationale", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:11:00.000Z",
    },
  );
  const reviewed = recordApprovedReview(requested, "2026-08-25T10:12:00.000Z");

  assert.throws(
    () =>
      promotePlaybookCandidate(reviewed, {
        independentReview: reviewed.independentReview,
        humanDecision: { decision: "APPROVED", actor: "mission-owner" },
      }),
    /human approval requires an actor and rationale/,
  );
  assert.throws(
    () =>
      promotePlaybookCandidate(reviewed, {
        independentReview: reviewed.independentReview,
        humanDecision: {
          decision: "APPROVED",
          rationale: "The approval must be traceable to a human actor.",
        },
      }),
    /human approval requires an actor and rationale/,
  );
  assert.throws(
    () =>
      rejectPlaybookCandidate(
        createPlaybookCandidate(playbookCandidateInput()),
        { decision: "REJECTED", actor: "mission-owner" },
      ),
    /human rejection requires an actor and rationale/,
  );

  const promoted = promotePlaybookCandidate(reviewed, {
    independentReview: reviewed.independentReview,
    humanDecision: {
      decision: "APPROVED",
      actor: "mission-owner",
      rationale: "Create an active version for the rollback validation.",
    },
  });
  assert.throws(
    () =>
      rollbackPlaybookCandidate(promoted, {
        decision: "ROLLED_BACK",
        actor: "mission-owner",
      }),
    /human rollback requires an actor and rationale/,
  );
});

test("candidate evaluation rejects colliding immutable Baseline and Candidate version identities", () => {
  const input = playbookCandidateInput();
  input.baseline.id = "playbook:baseline@release";
  input.baseline.version = "1";
  input.candidate.id = "playbook:baseline";
  input.candidate.version = "release@1";
  input.candidate.basedOn = {
    id: input.baseline.id,
    version: input.baseline.version,
  };

  assert.throws(
    () => createPlaybookCandidate(input),
    /distinct immutable version identities/,
  );
});

test("an independent approval cannot be recorded without a review dispatch", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:20:00.000Z",
    },
  );
  const review = approvedReviewPayload({
    ...requested,
    reviewDispatch: playbookReviewDispatchPayload(requested),
  });

  assert.throws(
    () => recordIndependentPlaybookReview(requested, review),
    /active transport review dispatch/,
  );
  assert.equal(requested.status, "PROMOTION_REQUESTED");
});

test("an independent approval must bind the active review dispatch identity", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:21:00.000Z",
    },
  );
  const dispatched = dispatchIndependentReview(requested);
  const review = approvedReviewPayload(dispatched);
  review.dispatchId = "playbook-review:stale-dispatch";

  assert.throws(
    () => recordIndependentPlaybookReview(dispatched, review),
    /active transport review dispatch/,
  );
  assert.equal(dispatched.status, "REVIEW_IN_PROGRESS");
});

test("an approved independent review rejects any unresolved findings", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:22:00.000Z",
    },
  );
  const dispatched = dispatchIndependentReview(requested);
  const approval = approvedReviewPayload(dispatched);
  approval.findings = ["A critical evidence gap remains unresolved."];

  assert.throws(
    () => recordIndependentPlaybookReview(dispatched, approval),
    /approved independent review requires an empty findings list/,
  );
  assert.equal(dispatched.status, "REVIEW_IN_PROGRESS");
});

test("a negative independent review is durable with its findings and Evidence", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:23:00.000Z",
    },
  );
  const dispatched = dispatchIndependentReview(requested);
  const review = rejectedReviewPayload(dispatched, "2026-08-25T10:24:00.000Z");
  const rejected = recordRejectedIndependentReview(
    dispatched,
    "2026-08-25T10:24:00.000Z",
  );

  assert.equal(rejected.status, "REVIEW_REJECTED");
  assert.deepEqual(rejected.reviewRejectionHistory, [review]);
  assert.deepEqual(rejected.reviewRejectionHistory[0].findings, [
    "The retry outcome has no traceable production evidence.",
  ]);
  assert.deepEqual(rejected.reviewRejectionHistory[0].evidenceRefs, [
    "evidence://playbook-independent-review",
  ]);
  assert.deepEqual(rejected.decisionHistory.map((entry) => entry.type), [
    "PROMOTION_REQUESTED",
    "INDEPENDENT_REVIEW_DISPATCHED",
    "INDEPENDENT_REVIEW_REJECTED",
  ]);
  assert.equal(Object.isFrozen(rejected.reviewRejectionHistory[0].findings), true);
});

test("a rejected unchanged candidate cannot be dispatched for another independent review", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:25:00.000Z",
    },
  );
  const rejected = recordRejectedIndependentReview(
    dispatchIndependentReview(requested),
    "2026-08-25T10:26:00.000Z",
  );

  assert.throws(
    () => dispatchIndependentReview(rejected, "2026-08-25T10:27:00.000Z"),
    /current promotion request before independent review dispatch/,
  );
  assert.equal(rejected.status, "REVIEW_REJECTED");
});

test("a human can explicitly close a durably rejected candidate", () => {
  const requested = requestPlaybookPromotion(
    createPlaybookCandidate(playbookCandidateInput()),
    {
      actor: "mission-owner",
      decidedAt: "2026-08-25T10:28:00.000Z",
    },
  );
  const independentlyRejected = recordRejectedIndependentReview(
    dispatchIndependentReview(requested),
    "2026-08-25T10:29:00.000Z",
  );
  const closed = rejectPlaybookCandidate(independentlyRejected, {
    decision: "REJECTED",
    actor: "mission-owner",
    rationale: "The documented review finding is not acceptable for promotion.",
    decidedAt: "2026-08-25T10:30:00.000Z",
  });

  assert.equal(closed.status, "REJECTED");
  assert.deepEqual(closed.reviewRejectionHistory, independentlyRejected.reviewRejectionHistory);
  assert.deepEqual(closed.rejectionHistory, [
    {
      candidateId: "playbook:retry-guidance",
      candidateVersion: "2",
      decision: "REJECTED",
      actor: "mission-owner",
      rationale: "The documented review finding is not acceptable for promotion.",
      decidedAt: "2026-08-25T10:30:00.000Z",
    },
  ]);
});
