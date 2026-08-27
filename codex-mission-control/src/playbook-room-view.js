import { escapeHtml, formatDate, humanize } from "./approval-room-view.js";

const METRIC_DEFINITIONS = Object.freeze([
  { key: "acceptancePassRate", label: "Acceptance pass rate", unit: "%" },
  { key: "criticalRegressions", label: "Critical regressions", unit: "count" },
  { key: "reviewFindings", label: "Review findings", unit: "count" },
  { key: "retries", label: "Retries", unit: "count" },
  { key: "cycleTimeMs", label: "Cycle time", unit: "ms" },
  { key: "tokenUse", label: "Token use", unit: "tokens" },
]);

const PLAYBOOK_ACTIONS = Object.freeze({
  evaluate_playbook_candidate: "Evaluate Playbook candidate",
  request_playbook_promotion: "Request Playbook promotion",
  record_playbook_independent_review: "Dispatch independent Playbook review",
  approve_playbook_promotion: "Approve Playbook promotion",
  reject_playbook_candidate: "Reject Playbook candidate",
  rollback_playbook_version: "Roll back active Playbook",
});

const PLAYBOOK_COMMANDS = Object.freeze({
  evaluate_playbook_candidate: Object.freeze({
    type: "EVALUATE_PLAYBOOK_CANDIDATE",
    field: "candidate",
    reason: "Mission owner evaluated the bounded Playbook Candidate",
  }),
  request_playbook_promotion: Object.freeze({
    type: "REQUEST_PLAYBOOK_PROMOTION",
    field: "request",
    reason: "Mission owner requested Playbook Candidate promotion",
  }),
  approve_playbook_promotion: Object.freeze({
    type: "APPROVE_PLAYBOOK_PROMOTION",
    field: "approval",
    reason: "Mission owner approved the reviewed Playbook Candidate",
  }),
  reject_playbook_candidate: Object.freeze({
    type: "REJECT_PLAYBOOK_CANDIDATE",
    field: "rejection",
    reason: "Mission owner rejected the Playbook Candidate",
  }),
  rollback_playbook_version: Object.freeze({
    type: "ROLLBACK_PLAYBOOK_VERSION",
    field: "rollback",
    reason: "Mission owner rolled back the active Playbook version",
  }),
});

function hasOwn(value, key) {
  return Boolean(
    value &&
      typeof value === "object" &&
      Object.prototype.hasOwnProperty.call(value, key),
  );
}

function cloneValue(value) {
  if (value === undefined) {
    return null;
  }
  return structuredClone(value);
}

function freezeDeep(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const child of Object.values(value)) {
    freezeDeep(child, seen);
  }
  return Object.freeze(value);
}

function cloneAndFreeze(value) {
  return freezeDeep(cloneValue(value));
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

export function buildPlaybookActionCommand(action, input = {}) {
  if (action === "record_playbook_independent_review") {
    throw new Error(
      "Independent Playbook review requires transport-backed Sol Reviewer dispatch.",
    );
  }
  const command = PLAYBOOK_COMMANDS[action];
  if (!command) {
    throw new Error(`Unknown Playbook action: ${String(action)}.`);
  }
  if (typeof input.actor !== "string" || input.actor.trim() === "") {
    throw new Error("Playbook action requires the declared release authority.");
  }
  const payloadValue =
    command.field === "request"
      ? {}
      : command.field === "candidate"
        ? input.candidate
        : { rationale: input.rationale };
  return freezeDeep({
    type: command.type,
    payload: { [command.field]: cloneValue(payloadValue) },
    actor: input.actor,
    reason: command.reason,
    evidenceRefs:
      command.field === "approval"
        ? arrayOrEmpty(input.evidenceRefs).slice()
        : [],
  });
}

function metricValue(source, key) {
  return hasOwn(source, key) ? source[key] : null;
}

function comparisonMetric(playbook, key) {
  const comparison = objectOrEmpty(playbook.comparison?.metrics?.[key]);
  const baselineMetrics = objectOrEmpty(playbook.baseline?.metrics);
  const candidateMetrics = objectOrEmpty(playbook.candidate?.metrics);
  const baseline = firstDefined(
    hasOwn(comparison, "baseline") ? comparison.baseline : null,
    metricValue(baselineMetrics, key),
  );
  const candidate = firstDefined(
    hasOwn(comparison, "candidate") ? comparison.candidate : null,
    metricValue(candidateMetrics, key),
  );
  const delta = firstDefined(
    hasOwn(comparison, "delta") ? comparison.delta : null,
    typeof baseline === "number" && typeof candidate === "number"
      ? candidate - baseline
      : null,
  );
  return { baseline, candidate, delta };
}

function deriveEvaluationSet(playbook) {
  return cloneAndFreeze(
    firstDefined(
      playbook.comparison?.evaluationSet,
      playbook.baseline?.evaluationSet,
      playbook.candidate?.evaluationSet,
    ),
  );
}

function deriveRetrospective(playbook) {
  const source = objectOrEmpty(playbook.retrospective);
  return cloneAndFreeze({
    ...cloneValue(source),
    outcome: firstDefined(source.outcome, source.result),
    recurringFailurePattern: firstDefined(
      source.recurringFailurePattern,
      source.failurePattern,
      source.failure,
    ),
    evidenceRefs: cloneValue(
      arrayOrEmpty(firstDefined(source.evidenceRefs, source.evidence)),
    ),
  });
}

function deriveGate(playbook, key, metric) {
  const gates = objectOrEmpty(
    firstDefined(playbook.gates, playbook.comparison?.gates),
  );
  const recordedGate =
    key === "criticalRegressions"
      ? firstDefined(
          gates[key],
          gates.criticalRegression,
          gates.criticalRegressionGate,
        )
      : firstDefined(
          gates[key],
          gates.declaredTarget,
          gates.targetImprovement,
          gates.targetGate,
        );
  const source = firstDefined(
    recordedGate,
    key === "criticalRegressions"
      ? firstDefined(
          playbook.criticalRegressionGate,
          playbook.comparison?.criticalRegressionGate,
        )
      : firstDefined(
          playbook.targetGate,
          playbook.comparison?.targetGate,
        ),
  );
  if (typeof source === "string") {
    return { status: source, summary: null, baseline: metric.baseline, candidate: metric.candidate, delta: metric.delta };
  }
  if (typeof source === "boolean") {
    return {
      status: source ? "PASS" : "FAIL",
      summary: null,
      baseline: metric.baseline,
      candidate: metric.candidate,
      delta: metric.delta,
    };
  }
  if (source && typeof source === "object") {
    return {
      ...cloneValue(source),
      status: firstDefined(source.status, source.decision, source.state, "RECORDED"),
      baseline: firstDefined(source.baseline, metric.baseline),
      candidate: firstDefined(source.candidate, metric.candidate),
      delta: firstDefined(source.delta, metric.delta),
    };
  }
  return {
    status: "RECORDED",
    summary: null,
    baseline: metric.baseline,
    candidate: metric.candidate,
    delta: metric.delta,
  };
}

function normalizeActionList(actions) {
  return Object.freeze(
    arrayOrEmpty(actions).filter(
      (action, index, all) =>
        typeof action === "string" &&
        hasOwn(PLAYBOOK_ACTIONS, action) &&
        all.indexOf(action) === index,
    ),
  );
}

function normalizeEvidence(entry) {
  if (typeof entry === "string") {
    return { ref: entry, kind: "evidence", summary: null, details: null };
  }
  const source = objectOrEmpty(entry);
  return {
    ...cloneValue(source),
    ref: firstDefined(source.ref, source.id, "Unidentified Evidence"),
    kind: firstDefined(source.kind, "evidence"),
    summary: firstDefined(source.summary, source.reason),
    details: firstDefined(source.details, null),
  };
}

function normalizeDecision(value) {
  if (!value) {
    return null;
  }
  const source = objectOrEmpty(value);
  return cloneAndFreeze({
    ...cloneValue(source),
    decision: firstDefined(source.decision, source.status, source.outcome),
    actor: firstDefined(source.actor, source.reviewer, source.owner),
    summary: firstDefined(source.summary, source.rationale, source.reason),
  });
}

function normalizeHistory(value) {
  return Object.freeze(
    arrayOrEmpty(value).map((entry) => cloneAndFreeze(entry)),
  );
}

export function derivePlaybookRoomModel(mission) {
  const sourceMission = mission && typeof mission === "object" ? mission : {};
  const playbook = sourceMission.playbook;
  const missionId = firstDefined(sourceMission.id, "Unknown Mission");
  const goal = firstDefined(sourceMission.brief?.goal, "No Mission goal recorded");

  if (
    !playbook ||
    typeof playbook !== "object" ||
    playbook.status === "NOT_EVALUATED"
  ) {
    const actions = normalizeActionList(sourceMission.allowedActions);
    return freezeDeep({
      empty: true,
      missionId,
      goal,
      missionStatus: firstDefined(sourceMission.status, "UNKNOWN"),
      status: null,
      actions,
      allowedActions: actions,
    });
  }

  const metrics = METRIC_DEFINITIONS.map((definition) => ({
    ...definition,
    ...comparisonMetric(playbook, definition.key),
  }));
  const retrospective = deriveRetrospective(playbook);
  const evidence = Object.freeze(
    retrospective.evidenceRefs.map((entry) =>
      cloneAndFreeze(normalizeEvidence(entry)),
    ),
  );
  const metricByKey = Object.fromEntries(
    metrics.map((metric) => [metric.key, metric]),
  );

  return freezeDeep({
    empty: false,
    missionId,
    goal,
    missionStatus: firstDefined(sourceMission.status, "UNKNOWN"),
    status: firstDefined(playbook.status, "UNKNOWN"),
    retrospective,
    evidence,
    evaluationSet: deriveEvaluationSet(playbook),
    baseline: cloneAndFreeze(playbook.baseline),
    candidate: cloneAndFreeze(playbook.candidate),
    metrics: Object.freeze(metrics),
    declaredTarget: cloneAndFreeze(playbook.declaredTarget),
    gates: Object.freeze({
      criticalRegressions: cloneAndFreeze(
        deriveGate(playbook, "criticalRegressions", metricByKey.criticalRegressions),
      ),
      target: cloneAndFreeze(
        deriveGate(
          playbook,
          "target",
          metricByKey[playbook.declaredTarget?.metric] ??
            metricByKey.acceptancePassRate,
        ),
      ),
    }),
    independentReview: normalizeDecision(playbook.independentReview),
    humanDecision: normalizeDecision(playbook.humanDecision),
    promotedVersions: normalizeHistory(playbook.promotedVersions),
    activePromotedVersionId: firstDefined(playbook.activePromotedVersionId),
    rejectionHistory: normalizeHistory(playbook.rejectionHistory),
    rollbackHistory: normalizeHistory(playbook.rollbackHistory),
    decisionHistory: normalizeHistory(playbook.decisionHistory),
    actions: normalizeActionList(sourceMission.allowedActions),
    allowedActions: normalizeActionList(sourceMission.allowedActions),
  });
}

function displayNumber(value, maximumFractionDigits = 2) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(value);
}

function displayMetricValue(value, metric, { delta = false } = {}) {
  if (value === null || value === undefined || value === "") {
    return "Not recorded";
  }
  let display = value;
  if (metric.key === "acceptancePassRate" && typeof value === "number") {
    display = value >= 0 && value <= 1 ? value * 100 : value;
    display = `${displayNumber(display)}%`;
  } else if (typeof value === "number") {
    display = displayNumber(value);
    if (delta && value > 0) {
      display = `+${display}`;
    }
    display = `${display} ${metric.unit}`;
  } else {
    display = `${String(value)}${metric.unit === "%" ? "%" : ` ${metric.unit}`}`;
  }
  return display;
}

function displayDate(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return null;
  }
  return formatDate(value);
}

function serializeValue(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function text(value, fallback = "Not recorded") {
  return escapeHtml(
    value === null || value === undefined || value === "" ? fallback : value,
  );
}

function renderEvidence(evidence) {
  const detail = serializeValue(evidence.details);
  return `
    <li class="playbook-evidence-item">
      <strong>${text(evidence.kind, "Evidence")}</strong>
      <code>${text(evidence.ref)}</code>
      <p>${text(evidence.summary, "Evidence reference recorded")}</p>
      ${detail ? `<pre tabindex="0" aria-label="Evidence details">${escapeHtml(detail)}</pre>` : ""}
    </li>
  `;
}

function renderTime(value) {
  const formatted = displayDate(value);
  return formatted
    ? `<time datetime="${text(value)}">${text(formatted)}</time>`
    : "";
}

function recordLabel(record) {
  return firstDefined(
    record.id,
    record.versionId,
    record.candidateId,
    record.type,
    "Playbook record",
  );
}

function recordDescription(record) {
  return firstDefined(
    record.summary,
    record.rationale,
    record.reason,
    record.decision,
    record.outcome,
    "No decision summary recorded",
  );
}

function versionIdentity(version) {
  const id = firstDefined(version?.id, "Version not recorded");
  const versionNumber = firstDefined(version?.version);
  if (
    versionNumber !== null &&
    versionNumber !== undefined &&
    !String(id).endsWith(`@${String(versionNumber)}`)
  ) {
    return `${id}@${versionNumber}`;
  }
  return id;
}

function isActiveVersion(version, activeVersionId) {
  if (!activeVersionId) {
    return false;
  }
  return (
    version.id === activeVersionId ||
    versionIdentity(version) === activeVersionId
  );
}

function renderHistoryList(records, emptyMessage, className) {
  if (!records.length) {
    return `<li class="${className}-empty">${text(emptyMessage)}</li>`;
  }
  return [...records]
    .reverse()
    .map(
      (record) => `
        <li class="${className}-item">
          <div>
            <strong>${text(recordLabel(record))}</strong>
            <p>${text(recordDescription(record))}</p>
            ${
              record.actor || record.reviewer
                ? `<small>${text(firstDefined(record.actor, record.reviewer))}</small>`
                : ""
            }
          </div>
          ${renderTime(firstDefined(record.occurredAt, record.decidedAt, record.recordedAt, record.createdAt))}
        </li>
      `,
    )
    .join("");
}

function renderMetricTable(metrics) {
  return `
    <table aria-label="Candidate and Baseline metrics">
      <thead>
        <tr>
          <th scope="col">Metric</th>
          <th scope="col">Baseline</th>
          <th scope="col">Candidate</th>
          <th scope="col">Delta</th>
        </tr>
      </thead>
      <tbody>
        ${metrics
          .map(
            (metric) => `
              <tr>
                <th scope="row">${text(metric.label)}</th>
                <td data-unit="${text(metric.unit)}">${text(displayMetricValue(metric.baseline, metric))}</td>
                <td data-unit="${text(metric.unit)}">${text(displayMetricValue(metric.candidate, metric))}</td>
                <td data-unit="${text(metric.unit)}">${text(displayMetricValue(metric.delta, metric, { delta: true }))}</td>
              </tr>
            `,
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderGate(gate, label, metric) {
  const status = firstDefined(gate.status, "RECORDED");
  const summary = firstDefined(
    gate.summary,
    "The projected comparison does not include a separate gate explanation.",
  );
  return `
    <article class="playbook-gate">
      <h3>${text(label)}</h3>
      <strong>${text(humanize(status))}</strong>
      <p>${text(summary)}</p>
      <small>Baseline ${text(displayMetricValue(gate.baseline, metric))}; Candidate ${text(displayMetricValue(gate.candidate, metric))}; Delta ${text(displayMetricValue(gate.delta, metric, { delta: true }))}</small>
    </article>
  `;
}

function renderDecision(decision, emptyMessage) {
  if (!decision) {
    return `<p class="playbook-decision-empty">${text(emptyMessage)}</p>`;
  }
  return `
    <div class="playbook-decision">
      <strong>${text(firstDefined(decision.decision, "Recorded"))}</strong>
      <p>${text(decision.summary)}</p>
      <small>${text(firstDefined(decision.actor, decision.reviewer, "Recorded actor"))}</small>
      ${renderTime(firstDefined(decision.occurredAt, decision.decidedAt, decision.recordedAt))}
    </div>
  `;
}

function renderActionControls(actions) {
  if (!actions.length) {
    return `<p class="playbook-actions-empty">No Playbook action is currently authorized.</p>`;
  }
  return actions
    .map(
      (action) => `
        <button class="secondary-button" type="button" data-playbook-action="${text(action)}">${text(PLAYBOOK_ACTIONS[action])}</button>
      `,
    )
    .join("");
}

export function renderPlaybookRoomContent(model) {
  const view = model && typeof model === "object" ? model : {};
  if (view.empty) {
    const actions = normalizeActionList(view.actions ?? view.allowedActions);
    return `
      <section class="playbook-empty-state" aria-labelledby="playbook-title">
        <p class="eyebrow">${text(firstDefined(view.missionId, "Mission"))} · PLAYBOOK ROOM</p>
        <h1 id="playbook-title" tabindex="-1">No Playbook Candidate yet</h1>
        <p>${text(view.goal, "A completed Mission has no projected Playbook state to inspect.")}</p>
        <div role="group" aria-label="Allowed Playbook actions">
          ${renderActionControls(actions)}
        </div>
      </section>
    `;
  }

  const metrics = Array.isArray(view.metrics) ? view.metrics : [];
  const evaluationSet = objectOrEmpty(view.evaluationSet);
  const baseline = objectOrEmpty(view.baseline);
  const candidate = objectOrEmpty(view.candidate);
  const retrospective = objectOrEmpty(view.retrospective);
  const evidence = arrayOrEmpty(view.evidence);
  const gates = objectOrEmpty(view.gates);
  const actions = normalizeActionList(view.actions ?? view.allowedActions);
  const promotedVersions = arrayOrEmpty(view.promotedVersions);
  const versionsMarkup = promotedVersions.length
    ? promotedVersions
        .map(
          (version) => `
            <li>
              <strong>${text(versionIdentity(version))}</strong>
              <span>${text(version.version, "Version not recorded")}</span>
              ${isActiveVersion(version, view.activePromotedVersionId) ? `<b>Active</b>` : ""}
            </li>
          `,
        )
        .join("")
    : `<li class="playbook-history-empty">No immutable promoted version recorded.</li>`;

  const evaluationSetLabel = [evaluationSet.id, evaluationSet.version]
    .filter((value) => value !== null && value !== undefined && value !== "")
    .join(" · ");
  const criticalMetric =
    metrics.find((metric) => metric.key === "criticalRegressions") ??
    METRIC_DEFINITIONS.find((metric) => metric.key === "criticalRegressions");
  const targetMetric =
    metrics.find((metric) => metric.key === (view.declaredTarget?.metric ?? "acceptancePassRate")) ??
    metrics.find((metric) => metric.key === "acceptancePassRate") ??
    METRIC_DEFINITIONS.find((metric) => metric.key === "acceptancePassRate");
  const declaredTarget = objectOrEmpty(view.declaredTarget);
  const targetValue =
    typeof declaredTarget.minimumImprovement === "number"
      ? displayMetricValue(declaredTarget.minimumImprovement, targetMetric, { delta: true })
      : firstDefined(declaredTarget.minimumImprovement, "Not recorded");

  return `
    <section class="playbook-hero" aria-labelledby="playbook-title">
      <div>
        <p class="eyebrow">${text(view.missionId)} · PLAYBOOK ROOM</p>
        <h1 id="playbook-title" tabindex="-1">Candidate Playbook evaluation</h1>
        <p>${text(view.goal)}</p>
      </div>
      <div class="playbook-status">
        <span>Projected status</span>
        <strong>${text(view.status)}</strong>
        <small>Mission ${text(view.missionStatus)}</small>
      </div>
    </section>

    <section class="playbook-retrospective" aria-labelledby="playbook-retrospective-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">OBSERVED OUTCOME</p>
          <h2 id="playbook-retrospective-title">Retrospective and Evidence</h2>
        </div>
        <span class="record-count">${text(retrospective.outcome, "Outcome not recorded")}</span>
      </div>
      <p><strong>Recurring failure pattern:</strong> ${text(retrospective.recurringFailurePattern)}</p>
      <ul class="playbook-evidence-list" aria-label="Retrospective Evidence">
        ${evidence.length ? evidence.map(renderEvidence).join("") : `<li>No retrospective Evidence references recorded.</li>`}
      </ul>
    </section>

    <section class="playbook-comparison" aria-labelledby="playbook-comparison-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">FIXED EVALUATION</p>
          <h2 id="playbook-comparison-title">Candidate vs Baseline</h2>
        </div>
        <span class="record-count">${text(evaluationSetLabel, "Evaluation set not recorded")}</span>
      </div>
      <div class="playbook-identities">
        <p><span>Baseline</span> <strong>${text(baseline.id)}</strong> <small>v${text(baseline.version, "?")}</small></p>
        <p><span>Candidate</span> <strong>${text(candidate.id)}</strong> <small>v${text(candidate.version, "?")}</small></p>
        <p><span>Evaluation set</span> <strong>${text(evaluationSetLabel)}</strong></p>
        ${
          Array.isArray(evaluationSet.caseIds)
            ? `<p><span>Evaluation cases</span> <strong>${text(evaluationSet.caseIds.join(", "), "No cases recorded")}</strong></p>`
            : ""
        }
      </div>
      <p class="playbook-candidate-change"><strong>Proposed change:</strong> ${text(candidate.change?.summary)}</p>
      ${renderMetricTable(metrics)}
    </section>

    <section class="playbook-gates" aria-labelledby="playbook-gates-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">PROMOTION BOUNDARIES</p>
          <h2 id="playbook-gates-title">Critical regression and target gates</h2>
        </div>
      </div>
      <div class="playbook-gate-grid">
        ${renderGate(gates.criticalRegressions ?? {}, "Critical regression gate", criticalMetric)}
        <article class="playbook-gate">
          <h3>Declared target</h3>
          <strong>${text(firstDefined(declaredTarget.metric, "Not recorded"))}</strong>
          <p>Minimum improvement: ${text(targetValue)}</p>
          <small>Target comparison: Baseline ${text(displayMetricValue(targetMetric.baseline, targetMetric))}; Candidate ${text(displayMetricValue(targetMetric.candidate, targetMetric))}; Delta ${text(displayMetricValue(targetMetric.delta, targetMetric, { delta: true }))}</small>
        </article>
        ${gates.target ? renderGate(gates.target, "Target gate", targetMetric) : ""}
      </div>
    </section>

    <section class="playbook-decisions" aria-labelledby="playbook-decisions-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">REQUIRED AUTHORITIES</p>
          <h2 id="playbook-decisions-title">Review and human approval</h2>
        </div>
      </div>
      <div class="playbook-decision-grid">
        <article><h3>Independent review</h3>${renderDecision(view.independentReview, "No independent review has been recorded.")}</article>
        <article><h3>Human approval</h3>${renderDecision(view.humanDecision, "No explicit human approval has been recorded.")}</article>
      </div>
    </section>

    <section class="playbook-history" aria-labelledby="playbook-history-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">IMMUTABLE RECORD</p>
          <h2 id="playbook-history-title">Promoted versions and decision history</h2>
        </div>
        <span class="record-count">Active ${text(view.activePromotedVersionId, "none")}</span>
      </div>
      <div class="playbook-history-grid">
        <article><h3>Promoted versions</h3><ul>${versionsMarkup}</ul></article>
        <article><h3>Rejection history</h3><ul>${renderHistoryList(arrayOrEmpty(view.rejectionHistory), "No rejected candidate is recorded.", "playbook-rejection-history")}</ul></article>
        <article><h3>Rollback history</h3><ul>${renderHistoryList(arrayOrEmpty(view.rollbackHistory), "No rollback is recorded.", "playbook-rollback-history")}</ul></article>
        <article><h3>Decision history</h3><ol>${renderHistoryList(arrayOrEmpty(view.decisionHistory), "No Playbook decision is recorded.", "playbook-decision-history")}</ol></article>
      </div>
    </section>

    <section class="playbook-actions" aria-labelledby="playbook-actions-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">MISSION AUTHORIZATION</p>
          <h2 id="playbook-actions-title">Available actions</h2>
        </div>
      </div>
      <div role="group" aria-label="Allowed Playbook actions">
        ${renderActionControls(actions)}
      </div>
    </section>
  `;
}
