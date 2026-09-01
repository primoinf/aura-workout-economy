const METRIC_NAMES = [
  "acceptancePassRate",
  "criticalRegressions",
  "reviewFindings",
  "retries",
  "cycleTimeMs",
  "tokenUse",
];

const RATE_METRICS = new Set(["acceptancePassRate"]);

function clone(value) {
  return structuredClone(value);
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sameStrings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function metricDelta(metric, baseline, candidate) {
  return Number((candidate - baseline).toFixed(12));
}

function metricImprovement(metric, baseline, candidate) {
  const delta = metricDelta(metric, baseline, candidate);
  return RATE_METRICS.has(metric) ? delta : -delta;
}

function assertMetrics(metrics, subject) {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    throw new Error(`${subject} metrics are required.`);
  }
  for (const metric of METRIC_NAMES) {
    const value = metrics[metric];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(
        `${subject} metrics ${metric} must be finite and non-negative.`,
      );
    }
    if (RATE_METRICS.has(metric) && value > 1) {
      throw new Error(
        `${subject} metrics ${metric} must be from 0 to 1.`,
      );
    }
  }
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Playbook Candidate ${field} is required.`);
  }
}

function assertVersionedIdentity(value, subject) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Playbook Candidate ${subject} is required.`);
  }
  assertNonEmptyString(value.id, `${subject} id`);
  assertNonEmptyString(value.version, `${subject} version`);
}

function assertProtectedConfiguration(value, subject) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `Playbook Candidate ${subject} protected configuration must be an object.`,
    );
  }
}

function assertRetrospective(retrospective) {
  if (!retrospective || typeof retrospective !== "object") {
    throw new Error("Playbook Candidate retrospective is required.");
  }
  assertVersionedIdentity(retrospective, "Retrospective");
  assertNonEmptyString(retrospective.outcome, "retrospective outcome");
  assertNonEmptyString(
    retrospective.recurringFailurePattern,
    "retrospective recurring failure pattern",
  );
  if (
    !Array.isArray(retrospective.evidenceRefs) ||
    retrospective.evidenceRefs.length === 0 ||
    retrospective.evidenceRefs.some(
      (reference) =>
        typeof reference !== "string" || reference.trim() === "",
    )
  ) {
    throw new Error(
      "Playbook Candidate retrospective requires at least one Evidence reference.",
    );
  }
}

function assertEvaluationSet(evaluationSet, subject) {
  if (!evaluationSet || typeof evaluationSet !== "object") {
    throw new Error(`${subject} requires a versioned evaluation set.`);
  }
  if (
    typeof evaluationSet.id !== "string" ||
    evaluationSet.id.trim() === "" ||
    typeof evaluationSet.version !== "string" ||
    evaluationSet.version.trim() === ""
  ) {
    throw new Error(`${subject} requires a versioned evaluation set.`);
  }
  if (
    !Array.isArray(evaluationSet.caseIds) ||
    evaluationSet.caseIds.length === 0 ||
    evaluationSet.caseIds.some(
      (caseId) => typeof caseId !== "string" || caseId.trim() === "",
    ) ||
    new Set(evaluationSet.caseIds).size !== evaluationSet.caseIds.length
  ) {
    throw new Error(`${subject} requires at least one evaluation case.`);
  }
}

function assertCriticalRegressionCaseIds(value, subject) {
  const caseIds = value.criticalRegressionCaseIds;
  const evaluationCaseIds = new Set(value.evaluationSet.caseIds);
  if (
    !Array.isArray(caseIds) ||
    caseIds.some(
      (caseId) => typeof caseId !== "string" || caseId.trim() === "",
    ) ||
    new Set(caseIds).size !== caseIds.length ||
    caseIds.some((caseId) => !evaluationCaseIds.has(caseId))
  ) {
    throw new Error(
      `Playbook Candidate ${subject} critical regression case IDs must be unique strings from the evaluation set.`,
    );
  }
  if (value.metrics.criticalRegressions !== caseIds.length) {
    throw new Error(
      `Playbook Candidate ${subject} critical regression case IDs must match criticalRegressions.`,
    );
  }
}

function metricsFromCaseResults(caseResults) {
  const total = (field) =>
    caseResults.reduce((sum, result) => sum + result[field], 0);
  return {
    acceptancePassRate: Number(
      (
        total("acceptanceScore") / caseResults.length
      ).toFixed(12),
    ),
    criticalRegressions: caseResults.filter(
      (result) => result.criticalRegression,
    ).length,
    reviewFindings: total("reviewFindings"),
    retries: total("retries"),
    cycleTimeMs: total("cycleTimeMs"),
    tokenUse: total("tokenUse"),
  };
}

function assertObservableCaseResults(value, subject) {
  const caseResults = value.caseResults;
  const expectedCaseIds = value.evaluationSet.caseIds;
  if (
    !Array.isArray(caseResults) ||
    caseResults.length !== expectedCaseIds.length ||
    caseResults.some(
      (result, index) => result?.caseId !== expectedCaseIds[index],
    )
  ) {
    throw new Error(
      `Playbook Candidate ${subject} requires one observable result per evaluation case.`,
    );
  }
  const artifactRefs = [];
  const evidenceRefs = [];
  for (const result of caseResults) {
    if (
      !assertCaseMetric(result.acceptanceScore, true) ||
      typeof result.criticalRegression !== "boolean" ||
      !assertCaseMetric(result.reviewFindings) ||
      !assertCaseMetric(result.retries) ||
      !assertCaseMetric(result.cycleTimeMs) ||
      !assertCaseMetric(result.tokenUse) ||
      !isObservableReference(result.artifactRef) ||
      !Array.isArray(result.evidenceRefs) ||
      result.evidenceRefs.length === 0 ||
      result.evidenceRefs.some(
        (reference) => !isObservableReference(reference),
      ) ||
      new Set(result.evidenceRefs).size !== result.evidenceRefs.length
    ) {
      throw new Error(
        `Playbook Candidate ${subject} case results require Artifact, Evidence, and finite non-negative observations.`,
      );
    }
    artifactRefs.push(result.artifactRef);
    evidenceRefs.push(...result.evidenceRefs);
  }
  if (
    new Set(artifactRefs).size !== artifactRefs.length ||
    new Set(evidenceRefs).size !== evidenceRefs.length
  ) {
    throw new Error(
      `Playbook Candidate ${subject} case observations must use distinct Artifact and Evidence references.`,
    );
  }
  if (!sameValue(value.metrics, metricsFromCaseResults(caseResults))) {
    throw new Error(
      `Playbook Candidate ${subject} metrics must match observable case results.`,
    );
  }
  const criticalRegressionCaseIds = caseResults
    .filter((result) => result.criticalRegression)
    .map((result) => result.caseId);
  if (!sameStrings(value.criticalRegressionCaseIds, criticalRegressionCaseIds)) {
    throw new Error(
      `Playbook Candidate ${subject} critical regression case IDs must match observable case results.`,
    );
  }
}

function assertCaseMetric(value, rate = false) {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    (!rate || value <= 1)
  );
}

function isObservableReference(value) {
  return typeof value === "string" && value.trim() !== "";
}

function assertHumanDecision(humanDecision, action) {
  if (
    typeof humanDecision.actor !== "string" ||
    humanDecision.actor.trim() === "" ||
    typeof humanDecision.rationale !== "string" ||
    humanDecision.rationale.trim() === ""
  ) {
    throw new Error(
      `Playbook Candidate human ${action} requires an actor and rationale.`,
    );
  }
}

function versionIdFor(version) {
  return `${version.id}@${version.version}`;
}

function versionIdForSnapshot(snapshot) {
  return snapshot.versionId ?? versionIdFor(snapshot);
}

function baselineVersionSnapshot(state) {
  return {
    id: state.baseline.id,
    version: state.baseline.version,
    versionId: versionIdFor(state.baseline),
    source: "BASELINE",
    baseline: clone(state.baseline),
    evaluationSet: clone(state.baseline.evaluationSet),
    metrics: clone(state.baseline.metrics),
    protectedConfiguration: clone(state.baseline.protectedConfiguration),
  };
}

function candidateVersionSnapshot(state) {
  return {
    id: state.candidate.id,
    version: state.candidate.version,
    versionId: versionIdFor(state.candidate),
    source: "CANDIDATE",
    retrospective: clone(state.retrospective),
    candidate: clone(state.candidate),
    baseline: {
      id: state.baseline.id,
      version: state.baseline.version,
    },
    evaluationSet: clone(state.comparison.evaluationSet),
    comparison: clone(state.comparison),
    declaredTarget: clone(state.declaredTarget),
  };
}

function comparisonFor(baseline, candidate) {
  return {
    evaluationSet: clone(baseline.evaluationSet),
    metrics: Object.fromEntries(
      METRIC_NAMES.map((metric) => [
        metric,
        {
          baseline: baseline.metrics[metric],
          candidate: candidate.metrics[metric],
          delta: metricDelta(
            metric,
            baseline.metrics[metric],
            candidate.metrics[metric],
          ),
          improvement: metricImprovement(
            metric,
            baseline.metrics[metric],
            candidate.metrics[metric],
          ),
        },
      ]),
    ),
  };
}

export function createPlaybookCandidate({
  retrospective,
  baseline,
  candidate,
  declaredTarget,
}) {
  assertRetrospective(retrospective);
  assertVersionedIdentity(baseline, "Baseline");
  assertVersionedIdentity(candidate, "Candidate");
  assertVersionedIdentity(candidate?.basedOn, "Candidate basedOn");
  if (versionIdFor(baseline) === versionIdFor(candidate)) {
    throw new Error(
      "Playbook Candidate Baseline and Candidate must have distinct immutable version identities.",
    );
  }
  assertEvaluationSet(baseline?.evaluationSet, "Baseline");
  assertEvaluationSet(candidate?.evaluationSet, "Candidate");
  assertMetrics(retrospective?.metrics, "Retrospective");
  assertMetrics(baseline?.metrics, "Baseline");
  assertMetrics(candidate?.metrics, "Candidate");
  assertProtectedConfiguration(baseline?.protectedConfiguration, "Baseline");
  assertProtectedConfiguration(candidate?.protectedConfiguration, "Candidate");
  assertCriticalRegressionCaseIds(baseline, "Baseline");
  assertCriticalRegressionCaseIds(candidate, "Candidate");
  assertObservableCaseResults(baseline, "Baseline");
  assertObservableCaseResults(candidate, "Candidate");
  if (!sameValue(retrospective.metrics, baseline.metrics)) {
    throw new Error(
      "Playbook Candidate retrospective metrics must match the observed Baseline.",
    );
  }
  return deepFreeze({
    status: "EVALUATED",
    retrospective: clone(retrospective),
    baseline: clone(baseline),
    candidate: clone(candidate),
    declaredTarget: clone(declaredTarget),
    comparison: comparisonFor(baseline, candidate),
    independentReview: null,
    reviewDispatch: null,
    reviewRejectionHistory: [],
    humanDecision: null,
    promotedVersions: [],
    rejectionHistory: [],
    rollbackHistory: [],
    decisionHistory: [],
    activePromotedVersionId: null,
  });
}

export function requestPlaybookPromotion(state, { actor, decidedAt }) {
  if (state.status !== "EVALUATED") {
    throw new Error(
      "Playbook Candidate requires an evaluated Playbook Candidate before promotion.",
    );
  }
  if (
    state.candidate.basedOn?.id !== state.baseline.id ||
    state.candidate.basedOn?.version !== state.baseline.version
  ) {
    throw new Error(
      "Playbook Candidate cannot request promotion from a stale baseline.",
    );
  }
  if (
    state.candidate.evaluationSet?.id !== state.baseline.evaluationSet?.id ||
    state.candidate.evaluationSet?.version !==
      state.baseline.evaluationSet?.version
  ) {
    throw new Error(
      "Playbook Candidate and Baseline must use the same versioned evaluation set.",
    );
  }
  if (
    !sameStrings(
      state.candidate.evaluationSet?.caseIds,
      state.baseline.evaluationSet?.caseIds,
    )
  ) {
    throw new Error(
      "Playbook Candidate and Baseline must use the same versioned evaluation cases.",
    );
  }
  if (
    !sameValue(
      state.candidate.protectedConfiguration,
      state.baseline.protectedConfiguration,
    )
  ) {
    throw new Error(
      "Playbook Candidate cannot rewrite protected prompts, agent profiles, or security policy.",
    );
  }
  if (
    state.candidate.criticalRegressionCaseIds.some(
      (caseId) => !state.baseline.criticalRegressionCaseIds.includes(caseId),
    )
  ) {
    throw new Error(
      "Playbook Candidate cannot request promotion with a new critical regression.",
    );
  }
  if (!state.declaredTarget) {
    throw new Error(
      "Playbook Candidate requires a declared target improvement before promotion.",
    );
  }
  if (
    !METRIC_NAMES.includes(state.declaredTarget.metric) ||
    typeof state.declaredTarget.minimumImprovement !== "number" ||
    !Number.isFinite(state.declaredTarget.minimumImprovement) ||
    state.declaredTarget.minimumImprovement <= 0
  ) {
    throw new Error(
      "Playbook Candidate requires a declared target for a supported metric with a positive finite minimum improvement.",
    );
  }
  const targetImprovement =
    state.comparison.metrics[state.declaredTarget.metric]?.improvement;
  if (targetImprovement < state.declaredTarget.minimumImprovement) {
    throw new Error(
      "Playbook Candidate does not achieve its declared target improvement.",
    );
  }
  const next = clone(state);
  next.status = "PROMOTION_REQUESTED";
  next.decisionHistory.push({
    type: "PROMOTION_REQUESTED",
    actor,
    decidedAt,
  });
  return deepFreeze(next);
}

function assertReviewIdentity(state, identity, label) {
  if (
    identity?.candidateId !== state.candidate.id ||
    identity?.candidateVersion !== state.candidate.version ||
    identity.baseline?.id !== state.baseline.id ||
    identity.baseline?.version !== state.baseline.version ||
    !sameValue(identity.evaluationSet, state.candidate.evaluationSet)
  ) {
    throw new Error(
      `${label} must bind the current Playbook Candidate, Baseline, and evaluation set.`,
    );
  }
}

function assertReviewDispatch(state, dispatch) {
  if (!dispatch || typeof dispatch !== "object" || Array.isArray(dispatch)) {
    throw new Error("Playbook Candidate transport review dispatch is required.");
  }
  assertNonEmptyString(dispatch.id, "transport review dispatch id");
  assertReviewIdentity(
    state,
    dispatch,
    "Transport review dispatch",
  );
}

function assertActiveReviewDispatch(state, review) {
  if (
    state.status !== "REVIEW_IN_PROGRESS" ||
    !state.reviewDispatch ||
    review?.dispatchId !== state.reviewDispatch.id
  ) {
    throw new Error(
      "Playbook Candidate independent review requires the active transport review dispatch.",
    );
  }
  assertReviewDispatch(state, state.reviewDispatch);
}

function assertIndependentReviewRecord(state, review) {
  assertActiveReviewDispatch(state, review);
  if (
    review?.actor !== "agent:sol_reviewer" ||
    !Array.isArray(review.evidenceRefs) ||
    review.evidenceRefs.length === 0 ||
    review.evidenceRefs.some(
      (reference) => typeof reference !== "string" || reference.trim() === "",
    )
  ) {
    throw new Error(
      "Playbook Candidate independent review requires actor agent:sol_reviewer and at least one Evidence reference.",
    );
  }
  if (
    typeof review.rationale !== "string" ||
    review.rationale.trim() === "" ||
    !Array.isArray(review.findings) ||
    review.findings.some(
      (finding) => typeof finding !== "string" || finding.trim() === "",
    )
  ) {
    throw new Error(
      "Playbook Candidate independent review requires a non-empty rationale and findings list.",
    );
  }
  assertReviewIdentity(
    state,
    review,
    "Independent review",
  );
}

export function dispatchPlaybookIndependentReview(state, dispatch) {
  if (state.status !== "PROMOTION_REQUESTED") {
    throw new Error(
      "Playbook Candidate requires a current promotion request before independent review dispatch.",
    );
  }
  assertReviewDispatch(state, dispatch);

  const next = clone(state);
  next.status = "REVIEW_IN_PROGRESS";
  next.reviewDispatch = clone(dispatch);
  next.decisionHistory.push({
    type: "INDEPENDENT_REVIEW_DISPATCHED",
    ...clone(dispatch),
  });
  return deepFreeze(next);
}

export function recordIndependentPlaybookReview(state, review) {
  assertIndependentReviewRecord(state, review);
  if (
    review?.decision !== "APPROVED" ||
    review.reviewer !== "sol_reviewer" ||
    review.independent !== true ||
    review.effectivePermission !== "read-only"
  ) {
    throw new Error(
      "Playbook Candidate requires an approved independent read-only Sol Reviewer decision.",
    );
  }
  if (review.findings.length !== 0) {
    throw new Error(
      "Playbook Candidate approved independent review requires an empty findings list.",
    );
  }

  const next = clone(state);
  next.status = "REVIEW_APPROVED";
  next.independentReview = clone(review);
  next.decisionHistory.push({
    type: "INDEPENDENT_REVIEW_APPROVED",
    ...clone(review),
  });
  return deepFreeze(next);
}

export function recordRejectedPlaybookIndependentReview(state, review) {
  assertIndependentReviewRecord(state, review);
  if (
    review?.decision !== "REJECTED" ||
    review.reviewer !== "sol_reviewer" ||
    review.independent !== true ||
    review.effectivePermission !== "read-only"
  ) {
    throw new Error(
      "Playbook Candidate requires a rejected independent read-only Sol Reviewer decision.",
    );
  }
  if (review.findings.length === 0) {
    throw new Error(
      "Playbook Candidate rejected independent review requires at least one finding.",
    );
  }

  const next = clone(state);
  next.status = "REVIEW_REJECTED";
  next.independentReview = clone(review);
  next.reviewRejectionHistory.push(clone(review));
  next.decisionHistory.push({
    type: "INDEPENDENT_REVIEW_REJECTED",
    ...clone(review),
  });
  return deepFreeze(next);
}

export function promotePlaybookCandidate(
  state,
  { independentReview, humanDecision },
) {
  if (
    state.status !== "REVIEW_APPROVED" ||
    !state.independentReview ||
    !sameValue(independentReview, state.independentReview) ||
    independentReview?.decision !== "APPROVED" ||
    independentReview.independent !== true
  ) {
    throw new Error(
      "Playbook Candidate promotion requires a current recorded independent reviewer decision.",
    );
  }
  if (humanDecision?.decision !== "APPROVED") {
    throw new Error(
      "Playbook Candidate promotion requires explicit human approval.",
    );
  }
  assertHumanDecision(humanDecision, "approval");
  const next = clone(state);
  next.status = "PROMOTED";
  next.independentReview = clone(independentReview);
  next.humanDecision = clone(humanDecision);
  next.promotedVersions.push(
    baselineVersionSnapshot(next),
    candidateVersionSnapshot(next),
  );
  next.activePromotedVersionId = versionIdFor(next.candidate);
  if (!state.independentReview) {
    next.decisionHistory.push({
      type: "INDEPENDENT_REVIEW_APPROVED",
      ...clone(independentReview),
    });
  }
  next.decisionHistory.push({
    type: "HUMAN_APPROVED",
    ...clone(humanDecision),
  });
  return deepFreeze(next);
}

export function rejectPlaybookCandidate(state, humanDecision) {
  if (
    ![
      "EVALUATED",
      "PROMOTION_REQUESTED",
      "REVIEW_APPROVED",
      "REVIEW_REJECTED",
    ].includes(state.status)
  ) {
    throw new Error(
      "Playbook Candidate rejection requires an unpromoted candidate.",
    );
  }
  if (humanDecision?.decision !== "REJECTED") {
    throw new Error(
      "Playbook Candidate rejection requires an explicit human rejection.",
    );
  }
  assertHumanDecision(humanDecision, "rejection");
  const next = clone(state);
  const rejection = {
    candidateId: next.candidate.id,
    candidateVersion: next.candidate.version,
    ...clone(humanDecision),
  };
  next.status = "REJECTED";
  next.humanDecision = clone(humanDecision);
  next.rejectionHistory.push(rejection);
  next.decisionHistory.push({
    type: "HUMAN_REJECTED",
    ...clone(humanDecision),
  });
  return deepFreeze(next);
}

export function rollbackPlaybookCandidate(state, humanDecision) {
  if (
    state.status !== "PROMOTED" ||
    typeof state.activePromotedVersionId !== "string" ||
    state.activePromotedVersionId.trim() === ""
  ) {
    throw new Error(
      "Playbook Candidate rollback requires an active promoted Playbook version.",
    );
  }
  if (humanDecision?.decision !== "ROLLED_BACK") {
    throw new Error(
      "Playbook Candidate rollback requires an explicit human rollback.",
    );
  }
  assertHumanDecision(humanDecision, "rollback");
  const next = clone(state);
  const activeVersionIndex = next.promotedVersions.findIndex(
    (version) => versionIdForSnapshot(version) === next.activePromotedVersionId,
  );
  if (activeVersionIndex <= 0) {
    throw new Error(
      "Playbook Candidate rollback requires an earlier immutable Playbook version.",
    );
  }
  const restoredVersionId = versionIdForSnapshot(
    next.promotedVersions[activeVersionIndex - 1],
  );
  const rollback = {
    versionId: next.activePromotedVersionId,
    fromVersionId: next.activePromotedVersionId,
    toVersionId: restoredVersionId,
    candidateId: next.candidate.id,
    candidateVersion: next.candidate.version,
    ...clone(humanDecision),
  };
  next.status = "ROLLED_BACK";
  next.activePromotedVersionId = restoredVersionId;
  next.rollbackHistory.push(rollback);
  next.decisionHistory.push({
    type: "HUMAN_ROLLED_BACK",
    ...clone(humanDecision),
  });
  return deepFreeze(next);
}
