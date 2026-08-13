import {
  escapeHtml,
  formatDate,
  humanize,
} from "./approval-room-view.js";

function renderReferences(references, emptyLabel = "None") {
  if (!references.length) {
    return `<span class="execution-empty">${escapeHtml(emptyLabel)}</span>`;
  }
  return `<ul class="execution-reference-list">${references
    .map((reference) => `<li>${escapeHtml(reference)}</li>`)
    .join("")}</ul>`;
}

function renderTaskNode(node, frontier) {
  const isFrontier = frontier.includes(node.id);
  const dependencyLabel = node.dependsOn.length
    ? `Depends on ${node.dependsOn.join(", ")}`
    : "No dependencies";
  return `
    <li>
      <article class="task-node state-${escapeHtml(node.status.toLowerCase().replaceAll("_", "-"))} ${isFrontier ? "is-frontier" : ""}">
        <div class="task-node-heading">
          <span class="task-node-id">${escapeHtml(node.id)} · attempt ${node.attempt}</span>
          <span class="task-node-status">${escapeHtml(humanize(node.status))}</span>
        </div>
        <h3>${escapeHtml(node.goal)}</h3>
        <p>${escapeHtml(dependencyLabel)}</p>
        <dl>
          <div><dt>Owner</dt><dd>${escapeHtml(node.roleName ?? "Not routed")}</dd></div>
          <div><dt>Permission</dt><dd>${escapeHtml(node.effectivePermission ?? "Not observed")}</dd></div>
          <div><dt>Artifacts</dt><dd>${node.artifactCount}</dd></div>
        </dl>
        ${node.currentWaveId ? `<small>Wave ${escapeHtml(node.currentWaveId)}</small>` : ""}
        ${node.latestEvidence ? `<small>Evidence ${escapeHtml(node.latestEvidence)}</small>` : ""}
      </article>
    </li>
  `;
}

function renderWave(wave) {
  const serialized = wave.serializedAssignmentIds.length
    ? `Serialized ${wave.serializedAssignmentIds.join(", ")}`
    : "No ownership serialization";
  const deferred = wave.deferredAssignmentIds.length
    ? `Deferred ${wave.deferredAssignmentIds.join(", ")}`
    : "No capacity deferral";
  return `
    <li class="execution-wave state-${escapeHtml(wave.status.toLowerCase())}">
      <div><strong>${escapeHtml(wave.id)}</strong><span>${escapeHtml(humanize(wave.status))}</span></div>
      <p>${escapeHtml(wave.assignmentIds.join(", "))}</p>
      <small>${escapeHtml(serialized)} · ${escapeHtml(deferred)}</small>
    </li>
  `;
}

function renderDecisionRoom(room) {
  const selectedAlternativeId =
    room.decision?.selectedAlternativeId ?? room.recommendation.alternativeId;
  return `
    <article class="decision-room-card state-${escapeHtml(room.status.toLowerCase())}">
      <div class="decision-room-heading">
        <div>
          <p class="eyebrow">${escapeHtml(room.id)} · ${escapeHtml(room.assignmentId)} · attempt ${room.assignmentAttempt}</p>
          <h3>${escapeHtml(room.question)}</h3>
        </div>
        <span class="task-node-status">${escapeHtml(humanize(room.status))}</span>
      </div>
      <p class="decision-participants">Participants ${escapeHtml(room.participantRoles.join(" · "))}</p>
      <div class="decision-participant-inputs">
        ${room.participantInputs
          .map(
            (input) => `<section><strong>${escapeHtml(input.roleId)}</strong><p>${escapeHtml(input.contribution)}</p>${renderReferences(input.evidenceRefs)}</section>`,
          )
          .join("")}
      </div>
      <p class="decision-expected-output"><strong>Expected Artifact</strong> ${escapeHtml(room.expectedOutput)}</p>
      <div class="decision-alternatives">
        ${room.alternatives
          .map(
            (alternative) => `
              <section class="decision-alternative ${alternative.id === selectedAlternativeId ? "is-selected" : ""}">
                <h4>${escapeHtml(alternative.label)}</h4>
                <strong>Trade-offs</strong>
                <ul>${alternative.tradeoffs.map((tradeoff) => `<li>${escapeHtml(tradeoff)}</li>`).join("")}</ul>
              </section>
            `,
          )
          .join("")}
      </div>
      <div class="decision-rationale-grid">
        <section>
          <span>Recommendation</span>
          <strong>${escapeHtml(room.recommendation.alternativeId)}</strong>
          <p>${escapeHtml(room.recommendation.rationale)}</p>
        </section>
        <section>
          <span>Validation plan</span>
          <ul>${room.validationPlan.map((step) => `<li>${escapeHtml(step)}</li>`).join("")}</ul>
        </section>
      </div>
      <div class="decision-evidence">
        <span>Input Evidence</span>
        ${renderReferences(room.inputEvidenceRefs)}
      </div>
      ${
        room.decision
          ? `<p class="decision-outcome"><strong>Decision ${escapeHtml(room.decision.selectedAlternativeId)}</strong> · ${escapeHtml(room.decision.rationale)} · ${escapeHtml(room.decision.actor)}</p>`
          : ""
      }
      ${
        room.decisionArtifact
          ? `<p class="decision-outcome"><strong>Decision Artifact</strong> ${escapeHtml(room.decisionArtifact.uri)} · ${escapeHtml(room.decisionArtifact.summary)}</p>`
          : ""
      }
    </article>
  `;
}

function renderActivity(activity) {
  return `
    <li>
      <span class="event-sequence">${String(activity.sequence).padStart(2, "0")}</span>
      <div class="event-copy">
        <div><strong>${escapeHtml(humanize(activity.type))}</strong><span>${escapeHtml(activity.actor)}</span></div>
        <p>${escapeHtml(activity.reason)}</p>
        <small>${escapeHtml(activity.assignmentId ?? "Mission coordination")}${activity.waveId ? ` · ${escapeHtml(activity.waveId)}` : ""}${activity.attempt ? ` · attempt ${activity.attempt}` : ""}</small>
        ${renderReferences(activity.evidenceRefs, "No Evidence on this observation")}
      </div>
      <time datetime="${escapeHtml(activity.occurredAt)}">${escapeHtml(formatDate(activity.occurredAt))}</time>
    </li>
  `;
}

export function renderTaskExecutionContent(model) {
  if (!model) {
    return "";
  }
  return `
    <section class="task-graph-panel" aria-labelledby="task-graph-title">
      <div class="section-heading compact">
        <div>
          <p class="eyebrow">DEPENDENCY-AWARE EXECUTION</p>
          <h2 id="task-graph-title">Task Graph</h2>
        </div>
        <span class="honesty-note ${model.observed ? "is-observed" : ""}"><span></span>${model.observed ? "Observed Assignment / Run events" : "Planned · no runtime observation"}</span>
      </div>
      <div class="execution-summary-grid">
        <article><span>Progress</span><strong>${model.summary.completedAssignments} / ${model.summary.totalAssignments}</strong></article>
        <article><span>Capacity</span><strong>${model.summary.workerCapacity} worker slots</strong><small>${model.summary.reservedSlots} Orchestrator slot reserved</small></article>
        <article><span>Available</span><strong>${model.summary.availableWorkerSlots}</strong><small>${model.activeAssignmentIds.length} active</small></article>
        <article><span>Frontier</span><strong>${model.frontier.length}</strong><small>${escapeHtml(model.frontier.join(", ") || "No unblocked work")}</small></article>
      </div>
      <ol class="task-node-grid">${model.nodes.map((node) => renderTaskNode(node, model.frontier)).join("")}</ol>
      <div class="execution-wave-list">
        <h3>Execution waves</h3>
        ${model.waves.length ? `<ol>${model.waves.map(renderWave).join("")}</ol>` : '<p class="execution-empty">No wave has been dispatched.</p>'}
      </div>
    </section>

    <section class="decision-room-panel" aria-labelledby="decision-room-title">
      <div class="section-heading compact">
        <div><p class="eyebrow">CONSEQUENTIAL JUDGMENT</p><h2 id="decision-room-title">Decision Rooms</h2></div>
        <span class="record-count">${model.decisionRooms.length} recorded</span>
      </div>
      <div class="decision-room-list">
        ${model.decisionRooms.length ? model.decisionRooms.map(renderDecisionRoom).join("") : '<p class="execution-empty">No consequential decision is recorded.</p>'}
      </div>
    </section>

    <section class="execution-activity-panel" aria-labelledby="execution-activity-title">
      <div class="section-heading compact">
        <div><p class="eyebrow">OBSERVABLE EVENTS</p><h2 id="execution-activity-title">Activity Stream</h2></div>
        <span class="record-count">${model.activity.length} observations</span>
      </div>
      ${model.activity.length ? `<ol class="event-ledger execution-activity">${model.activity.map(renderActivity).join("")}</ol>` : '<p class="execution-empty">No Assignment or Run observation is recorded.</p>'}
    </section>
  `;
}
