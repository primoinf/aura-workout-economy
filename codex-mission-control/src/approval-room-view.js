import {
  artifactHasInspectableDetail,
  artifactReference,
  firstInspectableArtifactDetail,
} from "./artifact-inspection.js";

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatDate(iso) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

export function humanize(value) {
  return String(value).toLowerCase().replaceAll("_", " ");
}

function serializeDetail(value) {
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

function renderArtifact(artifact, index) {
  const diff = firstInspectableArtifactDetail(artifact, ["diff", "patch"]);
  const content = firstInspectableArtifactDetail(artifact, ["content"]);
  const metadata = artifact.metadata ?? null;
  const primaryDetail = diff ?? content;
  const primaryDetailLabel = diff
    ? "Inline diff"
    : content
      ? "Artifact content"
      : "Inline diff or content";
  return `
    <li class="approval-artifact">
      <div class="approval-artifact-heading">
        <span>${index === 0 ? "Primary" : `Artifact ${index + 1}`}</span>
        <strong>${escapeHtml(artifact.name ?? `Candidate Artifact ${index + 1}`)}</strong>
      </div>
      <code>${escapeHtml(artifactReference(artifact) ?? "No stable Artifact reference supplied")}</code>
      ${
        artifact.summary
          ? `<p class="artifact-summary">${escapeHtml(artifact.summary)}</p>`
          : ""
      }
      <div class="artifact-review-detail">
        <span>${primaryDetailLabel}</span>
        ${
          primaryDetail
            ? `<pre class="artifact-diff" tabindex="0" aria-label="${escapeHtml(primaryDetailLabel)}">${escapeHtml(serializeDetail(primaryDetail))}</pre>`
            : `<p class="artifact-detail-missing">No inline diff supplied. This candidate cannot be approved until diff, patch, or content is recorded.</p>`
        }
      </div>
      ${
        diff && content
          ? `
            <div class="artifact-review-detail">
              <span>Artifact content</span>
              <pre class="artifact-content" tabindex="0" aria-label="Artifact content">${escapeHtml(serializeDetail(content))}</pre>
            </div>
          `
          : ""
      }
      ${
        metadata
          ? `
            <div class="artifact-review-detail">
              <span>Artifact metadata</span>
              <pre class="artifact-metadata" tabindex="0" aria-label="Artifact metadata">${escapeHtml(serializeDetail(metadata))}</pre>
            </div>
          `
          : ""
      }
    </li>
  `;
}

function renderEvidenceDetail(detail) {
  const details = serializeDetail(detail.details);
  return `
    <li class="approval-evidence">
      <div class="approval-evidence-heading">
        <span aria-hidden="true">✓</span>
        <strong>${escapeHtml(detail.kind ?? "evidence")}</strong>
        <code>${escapeHtml(detail.ref)}</code>
      </div>
      <p>${escapeHtml(detail.summary ?? "No Evidence summary recorded")}</p>
      <small>Source ${escapeHtml(detail.sourceEventType ?? "event")} #${escapeHtml(detail.sourceSequence ?? "?")}</small>
      ${details ? `<pre class="evidence-detail" tabindex="0" aria-label="Evidence details">${escapeHtml(details)}</pre>` : ""}
    </li>
  `;
}

export function buildApprovalDecisionCommand(mission, { decision, summary }) {
  if (!["approve", "reject"].includes(decision)) {
    throw new Error("Choose approve or reject before recording a decision.");
  }
  const normalizedSummary = String(summary ?? "").trim();
  if (!normalizedSummary) {
    throw new Error("A decision summary is required.");
  }
  const candidateArtifacts = Array.isArray(
    mission.releaseReadiness?.candidateArtifacts,
  )
    ? mission.releaseReadiness.candidateArtifacts
    : [mission.releaseReadiness?.candidate];
  if (
    !candidateArtifacts.length ||
    candidateArtifacts.some((artifact) => !artifactHasInspectableDetail(artifact))
  ) {
    throw new Error(
      "Release approval requires an inspectable diff, patch, or content for every candidate Artifact.",
    );
  }
  const approved = decision === "approve";
  return {
    type: approved ? "APPROVE_RELEASE" : "REJECT_RELEASE",
    payload: { approval: { summary: normalizedSummary } },
    actor: mission.brief.releaseAuthority,
    reason: approved
      ? "Release authority approved the exact current candidate"
      : "Release authority rejected the exact current candidate",
    evidenceRefs: [...mission.releaseReadiness.evidenceRefs],
  };
}

export function renderApprovalRoomContent(model) {
  const isPending = model.status === "APPROVAL_REQUIRED";
  const isRejected =
    model.status === "CHANGES_REQUESTED" && model.decision === "REJECTED";
  const candidateArtifacts = Array.isArray(model.candidateArtifacts)
    ? model.candidateArtifacts
    : [model.candidate];
  const hasInspectableCandidate = candidateArtifacts.every(
    artifactHasInspectableDetail,
  ) && candidateArtifacts.length > 0;
  const decisionAvailable =
    isPending &&
    model.canApprove &&
    model.canReject &&
    hasInspectableCandidate;
  const evidenceDetails = model.evidenceDetails?.length
    ? model.evidenceDetails
    : model.evidence.map((ref) => ({
        ref,
        kind: "evidence",
        summary: "Evidence reference recorded",
      }));
  const decisionHistory =
    model.decisionHistory.length === 0
      ? `<li class="approval-history-empty">No human decision has been recorded for this candidate.</li>`
      : [...model.decisionHistory]
          .reverse()
          .map(
            (decision) => `
              <li>
                <span class="decision-sequence">${String(decision.sequence).padStart(2, "0")}</span>
                <div>
                  <strong>${escapeHtml(humanize(decision.type))}</strong>
                  <p>${escapeHtml(decision.summary)}</p>
                  <small>${escapeHtml(decision.actor)} · ${escapeHtml(decision.reason)}</small>
                </div>
                <time datetime="${escapeHtml(decision.occurredAt)}">${escapeHtml(formatDate(decision.occurredAt))}</time>
              </li>
            `,
          )
          .join("");

  return `
    <section class="approval-hero">
      <div>
        <button class="back-link" type="button" data-route="detail">← Mission Flow</button>
        <p class="eyebrow">${escapeHtml(model.missionId)} · REVIEW LEDGER</p>
        <h1 id="page-title" tabindex="-1">${isPending ? (decisionAvailable ? "Release decision required" : "Release evidence incomplete") : isRejected ? "Release changes requested" : "Release readiness recorded"}</h1>
        <p>${escapeHtml(model.goal)}</p>
      </div>
      <div class="approval-status ${isPending ? "is-pending" : isRejected ? "is-rejected" : "is-approved"}">
        <span>${isPending ? "Awaiting" : isRejected ? "Rejected" : "Approved"}</span>
        <strong>${escapeHtml(humanize(model.status))}</strong>
        <small>${isRejected ? "No external action executed; correction is required" : "No external action executed"}</small>
      </div>
    </section>

    <section class="approval-summary-grid" aria-label="Release decision summary">
      <article class="approval-candidate-card">
        <p class="eyebrow">EXACT CANDIDATE</p>
        <h2>${escapeHtml(model.candidate.name ?? "Release candidate")}</h2>
        <ul class="approval-artifact-set" aria-label="Candidate Artifact set">
          ${candidateArtifacts.map(renderArtifact).join("")}
        </ul>
        <div class="candidate-meta">
          <span>Artifact set <strong>${candidateArtifacts.length}</strong></span>
          <span>Context Pack <strong>v${model.contextPackVersion}</strong></span>
          <span>Authority <strong>${escapeHtml(model.releaseAuthority)}</strong></span>
        </div>
      </article>

      <article class="approval-evidence-card">
        <p class="eyebrow">CURRENT PASSING EVIDENCE</p>
        <h2>${evidenceDetails.length} current references</h2>
        <ul class="approval-evidence-list">
          ${evidenceDetails.map(renderEvidenceDetail).join("")}
        </ul>
      </article>
    </section>

    <section class="release-commitment-grid" aria-label="Release commitments">
      <article>
        <span class="commitment-index">01</span>
        <p class="eyebrow">RESIDUAL RISK</p>
        <h2>What can still go wrong</h2>
        <p>${escapeHtml(model.residualRisk)}</p>
      </article>
      <article>
        <span class="commitment-index">02</span>
        <p class="eyebrow">INTENDED EXTERNAL ACTION</p>
        <h2>What approval permits next</h2>
        <p>${escapeHtml(model.intendedExternalAction)}</p>
      </article>
      <article>
        <span class="commitment-index">03</span>
        <p class="eyebrow">ROLLBACK COMMITMENT</p>
        <h2>How failure will be reversed</h2>
        <p>${escapeHtml(model.rollbackCommitment)}</p>
      </article>
    </section>

    <div class="approval-ledger-grid">
      <section class="ledger-panel approval-decision-panel" aria-labelledby="approval-decision-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">HUMAN AUTHORITY</p>
            <h2 id="approval-decision-title">${isPending ? "Record a bounded decision" : "Decision is immutable"}</h2>
          </div>
          <span class="record-count">${escapeHtml(model.releaseAuthority)}</span>
        </div>
        ${
          isPending && decisionAvailable
            ? `
              <form id="approval-decision-form" class="approval-form">
                <label class="field">
                  <span>Decision summary</span>
                  <textarea name="approvalSummary" required rows="4" placeholder="Explain why this exact candidate is approved or rejected."></textarea>
                </label>
                <p class="approval-boundary">Approval updates Mission state only. It does not commit, push, open a pull request, release, or deploy.</p>
                <div class="approval-actions">
                  <button class="secondary-button danger-button" type="submit" name="decision" value="reject">Reject and request changes</button>
                  <button class="primary-button" type="submit" name="decision" value="approve">Approve release readiness</button>
                </div>
              </form>
            `
            : isPending
              ? `
                <div class="approval-recorded approval-blocked">
                  <span aria-hidden="true">!</span>
                  <div>
                    <strong>Decision unavailable.</strong>
                    <p>Every candidate Artifact must include an inline diff, patch, or content before a human decision can be recorded.</p>
                  </div>
                </div>
              `
            : isRejected
              ? `
              <div class="approval-recorded approval-blocked">
                <span aria-hidden="true">!</span>
                <div>
                  <strong>Changes requested—not released.</strong>
                  <p>The immutable rejected snapshot remains available for inspection before the candidate is regenerated.</p>
                </div>
              </div>
            `
              : `
              <div class="approval-recorded">
                <span aria-hidden="true">✓</span>
                <div>
                  <strong>Ready to release—not released.</strong>
                  <p>The human decision is recorded below. A separate release capability and authority are still required.</p>
                </div>
              </div>
            `
        }
      </section>

      <section class="ledger-panel" aria-labelledby="decision-history-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">IMMUTABLE DECISION HISTORY</p>
            <h2 id="decision-history-title">Approval events</h2>
          </div>
          <span class="record-count">${model.decisionHistory.length} recorded</span>
        </div>
        <ol class="approval-history">${decisionHistory}</ol>
      </section>
    </div>
  `;
}
