import {
  DASHBOARD_FILTER_DEFAULTS,
  deriveOperationsDashboard,
} from "./operations-dashboard.js";

const GATE_EVENTS = new Set([
  "REVIEW_PASSED",
  "REVIEW_REJECTED",
  "VALIDATION_PASSED",
  "VALIDATION_FAILED",
  "RELEASE_APPROVED",
  "RELEASE_REJECTED",
  "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
  "PLAYBOOK_INDEPENDENT_REVIEW_REJECTED",
  "PLAYBOOK_PROMOTED",
  "PLAYBOOK_REJECTED",
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

function renderHeading(mission, title, eyebrow) {
  return `
    <section class="page-heading audit-heading">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1 id="page-title" tabindex="-1">${escapeHtml(title)}</h1>
        <p>${mission ? `${escapeHtml(mission.brief.goal)} · ${escapeHtml(mission.id)}` : "Observable local configuration and authority boundaries"}</p>
      </div>
    </section>
  `;
}

function renderEvidence(refs) {
  return refs?.length
    ? `<ul class="audit-evidence">${refs.map((ref) => `<li>${escapeHtml(ref)}</li>`).join("")}</ul>`
    : `<p class="audit-unavailable">No Evidence reference recorded.</p>`;
}

function renderArtifact(artifact) {
  const detail = artifact.diff ?? artifact.patch ?? artifact.content ?? null;
  return `
    <li class="audit-artifact">
      <strong>${escapeHtml(artifact.summary ?? artifact.name ?? "Artifact")}</strong>
      <code>${escapeHtml(artifact.uri ?? artifact.path ?? "No Artifact location")}</code>
      ${detail ? `<pre tabindex="0">${escapeHtml(detail)}</pre>` : `<p class="audit-unavailable">Inline Artifact detail unavailable.</p>`}
    </li>
  `;
}

function renderRuns(mission) {
  const nodes = mission.execution?.nodes ?? [];
  const content = nodes.length
    ? nodes
        .map(
          (node) => `
            <article class="audit-run-card">
              <div class="audit-run-heading">
                <div><span>${escapeHtml(node.assignment.id)}</span><h2>${escapeHtml(node.assignment.goal)}</h2></div>
                <strong>${escapeHtml(humanize(node.status))}</strong>
              </div>
              <dl class="audit-definition-grid">
                <div><dt>Agent</dt><dd>${escapeHtml(node.agent?.roleName ?? node.agent?.roleId ?? "Not assigned")}</dd></div>
                <div><dt>Run</dt><dd>${escapeHtml(node.run?.id ?? "Not started")} · ${escapeHtml(humanize(node.run?.status ?? "unavailable"))}</dd></div>
              </dl>
              <section aria-label="Artifacts for ${escapeHtml(node.assignment.id)}"><h3>Artifacts</h3><ul class="audit-artifact-list">${(node.artifacts ?? []).length ? node.artifacts.map(renderArtifact).join("") : `<li class="audit-unavailable">No Artifact submitted.</li>`}</ul></section>
              <section aria-label="Evidence for ${escapeHtml(node.assignment.id)}"><h3>Evidence</h3>${renderEvidence(node.evidenceRefs)}</section>
            </article>
          `,
        )
        .join("")
    : `<div class="operations-empty"><h2>No execution Runs recorded.</h2><p>This Mission has no replayed Task Graph execution telemetry.</p></div>`;
  return `${renderHeading(mission, "Runs & Artifacts", "EXECUTION AUDIT")}<section class="audit-card-grid">${content}</section>`;
}

function renderDecisionRooms(mission) {
  const rooms = mission.execution?.decisionRooms ?? [];
  const content = rooms.length
    ? rooms
        .map((room) => {
          const selected = room.alternatives.find(
            (alternative) =>
              alternative.id === room.decision?.selectedAlternativeId,
          );
          return `
            <article class="audit-decision-card">
              <div class="audit-run-heading"><div><span>${escapeHtml(room.id)}</span><h2>${escapeHtml(room.question)}</h2></div><strong>${escapeHtml(humanize(room.status))}</strong></div>
              <p>Participants: ${escapeHtml(room.participantRoles.join(", "))}</p>
              <ol>${room.alternatives.map((alternative) => `<li><strong>${escapeHtml(alternative.label)}</strong><span>${escapeHtml(alternative.tradeoffs.join(" · "))}</span></li>`).join("")}</ol>
              ${room.decision ? `<div class="audit-decision-outcome"><span>Selected ${escapeHtml(selected?.label ?? room.decision.selectedAlternativeId)}</span><strong>${escapeHtml(room.decision.rationale)}</strong><small>${escapeHtml(room.decision.actor)}</small></div>` : `<p class="audit-unavailable">Human decision pending.</p>`}
              <h3>Input Evidence</h3>${renderEvidence(room.inputEvidenceRefs)}
            </article>
          `;
        })
        .join("")
    : `<div class="operations-empty"><h2>No Decision Rooms recorded.</h2><p>Consequential choices will appear here when they are opened through the Mission Orchestrator.</p></div>`;
  return `${renderHeading(mission, "Decision Rooms", "DECISION AUDIT")}<section class="audit-card-grid">${content}</section>`;
}

function renderGates(mission) {
  const outcomes = mission.events.filter((event) => GATE_EVENTS.has(event.type));
  const content = outcomes.length
    ? `<ol class="gate-outcome-list">${outcomes
        .map(
          (event) => `
            <li>
              <span class="event-sequence">${String(event.sequence).padStart(2, "0")}</span>
              <div><h2>${escapeHtml(humanize(event.type))}</h2><p>${escapeHtml(event.reason)}</p><small>${escapeHtml(event.actor)} · ${escapeHtml(event.occurredAt)}</small>${renderEvidence(event.evidenceRefs)}</div>
            </li>
          `,
        )
        .join("")}</ol>`
    : `<div class="operations-empty"><h2>No Quality Gate outcome recorded.</h2><p>Review, validation, approval, and Playbook gates remain separate and unavailable until their events exist.</p></div>`;
  return `${renderHeading(mission, "Quality Gates", "GATE AUDIT")}<section class="ledger-panel">${content}</section>`;
}

function formatMetric(key, value) {
  if (value === null) return "Unavailable";
  if (key === "averageCycleTimeMs") {
    return `${Math.round(value / 60_000)} min`;
  }
  return typeof value === "number" ? value.toLocaleString("en-US") : value;
}

function renderMetrics(mission, now) {
  const model = deriveOperationsDashboard(
    [mission],
    DASHBOARD_FILTER_DEFAULTS,
    { now },
  );
  return `
    ${renderHeading(mission, "Metrics", "MISSION METRICS")}
    <section class="operations-metric-grid" aria-label="Traceable Mission metrics">
      ${Object.entries(model.metrics)
        .map(
          ([key, metric]) => `
            <article class="operations-metric ${metric.status === "unavailable" ? "is-unavailable" : "is-observed"}">
              <span>${escapeHtml(metric.label)}</span><strong>${escapeHtml(formatMetric(key, metric.value))}</strong><p>${escapeHtml(metric.explanation)}</p>
              ${metric.sources.length ? `<details class="metric-provenance"><summary>Trace sources</summary><ol>${metric.sources.map((source) => `<li><strong>${escapeHtml(source.missionId)} · event #${source.eventSequence}</strong>${renderEvidence(source.evidenceRefs)}</li>`).join("")}</ol></details>` : `<small>Telemetry unavailable</small>`}
            </article>
          `,
        )
        .join("")}
    </section>
  `;
}

function renderSettings(agentRoutingConnected) {
  return `
    ${renderHeading(null, "Local-only settings", "SYSTEM BOUNDARIES")}
    <section class="settings-grid">
      <article><h2>Persistence</h2><p>Mission history replays from <code>codex-mission-control-events-v1</code> on this device.</p></article>
      <article><h2>Agent routing</h2><p>${agentRoutingConnected ? "Agent transport connected; effective runtime facts appear only after observable Run events." : "Agent transport not connected. Configured roles do not imply observed runtime telemetry."}</p></article>
      <article><h2>External authority</h2><p>Mission Control never commits, pushes, releases, or deploys by itself. A bounded Mission authority and explicit human gate are required.</p></article>
      <article><h2>Accessibility</h2><p>The interface honors reduced-motion preferences, visible focus, semantic landmarks, and labelled native controls.</p></article>
    </section>
  `;
}

export function renderMissionAuditView(mission, view, options = {}) {
  if (["runs", "decisions", "gates", "metrics"].includes(view) && !mission) {
    throw new Error(`${humanize(view)} requires a selected Mission.`);
  }
  if (view === "runs") return renderRuns(mission);
  if (view === "decisions") return renderDecisionRooms(mission);
  if (view === "gates") return renderGates(mission);
  if (view === "metrics") {
    return renderMetrics(mission, options.now ?? new Date().toISOString());
  }
  if (view === "settings") {
    return renderSettings(Boolean(options.agentRoutingConnected));
  }
  throw new Error(`Unsupported Mission audit view: ${view}.`);
}
