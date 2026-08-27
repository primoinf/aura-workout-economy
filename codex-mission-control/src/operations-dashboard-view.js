const AGENT_OPTIONS = Object.freeze([
  ["all", "All agents"],
  ["orchestrator", "Orchestrator"],
  ["luna_worker", "Luna Worker"],
  ["terra_builder", "Terra Builder"],
  ["terra_debugger", "Terra Debugger"],
  ["sol_architect", "Sol Architect"],
  ["sol_reviewer", "Sol Reviewer"],
]);
const STATE_OPTIONS = Object.freeze([
  ["all", "All lifecycle states"],
  ["BRIEF_ACCEPTED", "Brief accepted"],
  ["CONTEXT_READY", "Context ready"],
  ["PLANNED", "Planned"],
  ["RUNNING", "Running"],
  ["IN_REVIEW", "In review"],
  ["CHANGES_REQUESTED", "Changes requested"],
  ["VALIDATING", "Validating"],
  ["APPROVAL_REQUIRED", "Approval required"],
  ["READY_TO_RELEASE", "Ready to release"],
  ["LEARNING", "Learning"],
  ["READY_TO_COMPLETE", "Ready to complete"],
  ["COMPLETED", "Completed"],
  ["BLOCKED", "Blocked"],
  ["CANCELLED", "Cancelled"],
]);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function humanize(value) {
  return String(value ?? "")
    .toLocaleLowerCase()
    .replaceAll("_", " ")
    .replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase());
}

function renderOptions(options, selected) {
  return options
    .map(
      ([value, label]) =>
        `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`,
    )
    .join("");
}

function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function formatMetricValue(key, metric) {
  if (metric.value === null) return "—";
  if (key === "averageCycleTimeMs") return formatDuration(metric.value);
  if (typeof metric.value === "number") return metric.value.toLocaleString("en-US");
  return metric.value;
}

function renderMetricSource(source) {
  return `
    <li>
      <strong>${escapeHtml(source.missionId)} · event #${escapeHtml(source.eventSequence)} · ${escapeHtml(source.eventType)}</strong>
      <span>${escapeHtml(source.label)}</span>
      ${source.evidenceRefs.length ? `<small>${source.evidenceRefs.map(escapeHtml).join(" · ")}</small>` : `<small>No Evidence reference attached to this event.</small>`}
    </li>
  `;
}

function renderMetric([key, metric]) {
  const unavailable = metric.status === "unavailable";
  return `
    <article class="operations-metric ${unavailable ? "is-unavailable" : "is-observed"}">
      <span>${escapeHtml(metric.label)}</span>
      <strong>${escapeHtml(formatMetricValue(key, metric))}</strong>
      <small>${unavailable ? "Telemetry unavailable" : "Replayed from observable history"}</small>
      <p>${escapeHtml(metric.explanation)}</p>
      ${
        metric.sources.length
          ? `<details class="metric-provenance"><summary>Trace ${metric.sources.length} source${metric.sources.length === 1 ? "" : "s"}</summary><ol>${metric.sources.map(renderMetricSource).join("")}</ol></details>`
          : ""
      }
    </article>
  `;
}

function renderMission(mission) {
  return `
    <article class="operations-mission-card">
      <button type="button" data-mission-id="${escapeHtml(mission.id)}" aria-label="Open Mission: ${escapeHtml(mission.goal)}">
        <div><span class="risk-badge risk-${escapeHtml(mission.risk)}">${escapeHtml(mission.risk)} risk</span><span class="status-badge">${escapeHtml(humanize(mission.status))}</span></div>
        <h3>${escapeHtml(mission.goal)}</h3>
        <p>${escapeHtml(mission.scope)}</p>
        <dl>
          <div><dt>Observed agents</dt><dd>${escapeHtml(mission.observedAgents.map(humanize).join(", ") || "No runtime observation")}</dd></div>
          <div><dt>Audit source</dt><dd>Event #${escapeHtml(mission.source.eventSequence)} · ${escapeHtml(mission.source.eventType)}</dd></div>
        </dl>
      </button>
    </article>
  `;
}

export function renderOperationsDashboardContent(model) {
  const { filters } = model;
  const missionContent = model.missions.length
    ? `<div class="operations-mission-grid">${model.missions.map(renderMission).join("")}</div>`
    : `
      <div class="operations-empty">
        <h2>No Missions match these filters.</h2>
        <p>Reset the URL-backed filters to return to the complete observable history.</p>
        <button class="secondary-button" type="button" data-clear-dashboard-filters>Clear filters</button>
      </div>
    `;

  return `
    <section class="page-heading operations-heading">
      <div>
        <p class="eyebrow">OPERATIONS / AUDIT</p>
        <h1 id="page-title" tabindex="-1">Mission operations</h1>
        <p>Filter replayed work, inspect capacity and quality signals, and trace every aggregate to its events and Evidence.</p>
      </div>
      <output class="record-count" aria-live="polite">${model.resultCount} matching Mission${model.resultCount === 1 ? "" : "s"}</output>
    </section>

    <form id="dashboard-filter-form" class="dashboard-filter-form" aria-label="Filter Mission operations">
      <label><span>Mission</span><input type="search" name="missionFilter" value="${escapeHtml(filters.mission)}" placeholder="ID, goal, or scope" /></label>
      <label><span>Agent</span><select name="agent">${renderOptions(AGENT_OPTIONS, filters.agent)}</select></label>
      <label><span>Lifecycle state</span><select name="state">${renderOptions(STATE_OPTIONS, filters.state)}</select></label>
      <label><span>Risk</span><select name="risk">${renderOptions([["all", "All risks"], ["low", "Low"], ["medium", "Medium"], ["high", "High"]], filters.risk)}</select></label>
      <label><span>Time</span><select name="time">${renderOptions([["all", "All history"], ["24h", "Last 24 hours"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]], filters.time)}</select></label>
      <div class="dashboard-filter-actions"><button class="primary-button" type="submit">Apply filters</button><button class="secondary-button" type="button" data-clear-dashboard-filters>Reset</button></div>
    </form>

    <section class="operations-metrics" aria-labelledby="operations-metrics-title">
      <div class="section-heading"><div><p class="eyebrow">OBSERVABLE SIGNALS</p><h2 id="operations-metrics-title">Operational health</h2></div><span class="honesty-note is-observed"><span></span> Missing runtime facts stay unavailable</span></div>
      <div class="operations-metric-grid">${Object.entries(model.metrics).map(renderMetric).join("")}</div>
    </section>

    <section class="section-block operations-results" aria-labelledby="operations-results-title">
      <div class="section-heading"><div><p class="eyebrow">FILTERED HISTORY</p><h2 id="operations-results-title">Missions</h2></div></div>
      ${missionContent}
    </section>
  `;
}
