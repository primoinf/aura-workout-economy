import {
  MISSION_COMMAND_BY_ACTION,
  MISSION_STATUS_ORDER,
  createBrowserWriteCoordinator,
  createLocalStorageEventStore,
  createMissionOrchestrator,
} from "./mission-orchestrator.js";

const orchestrator = createMissionOrchestrator({
  eventStore: createLocalStorageEventStore(),
  writeCoordinator: createBrowserWriteCoordinator(),
});

const app = document.querySelector("#app");
const lifecycleLabels = {
  BRIEF_ACCEPTED: "Brief",
  CONTEXT_READY: "Context",
  PLANNED: "Plan",
  RUNNING: "Run",
  IN_REVIEW: "Review",
  VALIDATING: "Validation",
  LEARNING: "Learning",
  READY_TO_COMPLETE: "Accept",
  COMPLETED: "Complete",
};
const lifecycle = MISSION_STATUS_ORDER.map((status) => [
  status,
  lifecycleLabels[status],
]);

const nextSteps = {
  capture_context: {
    label: "Capture Context",
    eyebrow: "Context Pack",
    description: "Bind the approved Brief to a versioned local Context Pack.",
    reason: "Captured the bounded Context Pack from the approved Brief",
    payload: (mission) => ({
      context: {
        summary: `Local Context Pack for ${mission.brief.goal}`,
        sourceRefs: ["local://brief", "local://ticket-01"],
      },
    }),
    evidenceRefs: [],
  },
  accept_plan: {
    label: "Accept Plan",
    eyebrow: "Plan",
    description: "Approve the mocked build, review, and validation sequence.",
    reason: "Accepted the Ticket 01 no-release execution plan",
    payload: () => ({
      plan: {
        steps: ["Mock local run", "Independent review", "Validation", "Learning"],
      },
    }),
    evidenceRefs: [],
  },
  start_run: {
    label: "Start Mock Run",
    eyebrow: "Run",
    description: "Start a bounded local run without external mutation.",
    reason: "Started the bounded local mock run",
    payload: () => ({
      run: { agentRole: "terra-builder-mock", mode: "local-only" },
    }),
    evidenceRefs: [],
  },
  submit_artifact: {
    label: "Submit Artifact",
    eyebrow: "Artifact",
    description: "Attach the local tracer-bullet artifact for review.",
    reason: "Submitted the local tracer-bullet artifact",
    payload: (mission) => ({
      artifact: {
        name: "Mission Control tracer bullet",
        uri: `local://missions/${mission.id}/artifact`,
      },
    }),
    evidenceRefs: ["local://evidence/artifact"],
  },
  pass_review: {
    label: "Pass Review",
    eyebrow: "Review Gate",
    description: "Record a mocked independent review with no material findings.",
    reason: "Mock independent review found no material issues",
    payload: () => ({
      review: { summary: "No material correctness or security findings" },
    }),
    evidenceRefs: ["local://evidence/review"],
  },
  pass_validation: {
    label: "Pass Validation",
    eyebrow: "Validation Gate",
    description: "Record passing local acceptance evidence.",
    reason: "Local acceptance validation passed",
    payload: () => ({
      validation: { summary: "Lifecycle and replay acceptance checks passed" },
    }),
    evidenceRefs: ["local://evidence/validation"],
  },
  capture_learning: {
    label: "Capture Learning",
    eyebrow: "Retrospective",
    description: "Record bounded learning without changing a Playbook.",
    reason: "Captured the Ticket 01 retrospective",
    payload: () => ({
      learning: {
        summary: "Keep Mission Orchestrator as the single behavioral seam",
      },
    }),
    evidenceRefs: ["local://evidence/learning"],
  },
  complete_no_release: {
    label: "Accept No-Release Outcome",
    eyebrow: "Human Decision",
    description: "Complete locally. No commit, push, PR, or deployment occurs.",
    reason: "Mission owner accepted the no-release outcome",
    payload: () => ({
      completion: { summary: "Accepted locally without release" },
    }),
    evidenceRefs: ["local://evidence/completion"],
  },
};

let activeMissionId = new URL(window.location.href).searchParams.get("mission");
let notice = null;

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(iso) {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));
}

function humanize(value) {
  return value.toLowerCase().replaceAll("_", " ");
}

function setActiveMission(missionId) {
  activeMissionId = missionId;
  const url = new URL(window.location.href);
  if (missionId) {
    url.searchParams.set("mission", missionId);
  } else {
    url.searchParams.delete("mission");
  }
  window.history.pushState({}, "", url);
  render();
  focusCurrentView();
}

function focusCurrentView() {
  document.querySelector("#page-title")?.focus();
}

function getMissions() {
  return orchestrator.listMissions().sort((left, right) => {
    const leftTime = left.events.at(-1)?.occurredAt ?? "";
    const rightTime = right.events.at(-1)?.occurredAt ?? "";
    return rightTime.localeCompare(leftTime);
  });
}

function renderShell(content, view) {
  const missions = getMissions();
  const completeCount = missions.filter(
    (mission) => mission.status === "COMPLETED",
  ).length;
  const activeCount = missions.length - completeCount;

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Primary navigation">
        <button class="brand" type="button" data-route="overview" aria-label="Codex Mission Control home">
          <span class="brand-mark" aria-hidden="true">C</span>
          <span>
            <strong>Codex</strong>
            <small>Mission Control</small>
          </span>
        </button>

        <nav class="nav-list">
          <button class="nav-item ${view === "overview" ? "is-active" : ""}" type="button" data-route="overview" ${view === "overview" ? 'aria-current="page"' : ""}>
            <span class="nav-icon" aria-hidden="true">⌘</span>
            <span>Overview</span>
          </button>
          <button class="nav-item ${view === "detail" ? "is-active" : ""}" type="button" data-route="detail" ${view === "detail" ? 'aria-current="page"' : ""} ${missions.length === 0 ? "disabled" : ""}>
            <span class="nav-icon" aria-hidden="true">↗</span>
            <span>Mission Detail</span>
          </button>
        </nav>

        <div class="sidebar-summary" aria-label="Local Mission summary">
          <span><strong>${activeCount}</strong> active</span>
          <span><strong>${completeCount}</strong> complete</span>
        </div>
        <div class="local-mode">
          <span class="pulse-dot" aria-hidden="true"></span>
          <span><strong>Local only</strong><small>No external actions</small></span>
        </div>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <div class="mobile-brand">
            <span class="brand-mark" aria-hidden="true">C</span>
            <span>Mission Control</span>
          </div>
          <div class="topbar-copy">
            <span class="system-state"><span class="pulse-dot" aria-hidden="true"></span> Orchestrator online</span>
            <span class="storage-state">Local event store · v1</span>
          </div>
          <button class="new-mission-button" type="button" data-open-brief>
            <span aria-hidden="true">＋</span> New Mission
          </button>
        </header>
        ${notice ? `<div class="notice ${notice.kind}" role="status">${escapeHtml(notice.message)}</div>` : ""}
        <main id="main-content" tabindex="-1">
          ${content}
        </main>
      </div>
    </div>
    ${renderBriefDialog()}
  `;

  wireShellEvents();
}

function renderOverview() {
  const missions = getMissions();
  const completed = missions.filter(
    (mission) => mission.status === "COMPLETED",
  ).length;
  const active = missions.length - completed;
  const totalEvents = missions.reduce(
    (sum, mission) => sum + mission.events.length,
    0,
  );

  const missionCards =
    missions.length === 0
      ? `
        <section class="empty-state" aria-labelledby="empty-title">
          <span class="empty-kicker">ZERO STATE</span>
          <h2 id="empty-title">Give the team a bounded Mission.</h2>
          <p>Create a complete Brief, then move it through an auditable local run. Ticket 01 never commits, pushes, or deploys.</p>
          <button class="primary-button" type="button" data-open-brief>Create the first Mission</button>
        </section>
      `
      : missions.map(renderMissionCard).join("");

  renderShell(
    `
      <section class="page-heading command-heading">
        <div>
          <p class="eyebrow">COMMAND DECK / LOCAL WORKSPACE</p>
          <h1 id="page-title" tabindex="-1">Mission Overview</h1>
          <p>One operational surface for bounded work, current gates, and durable evidence.</p>
        </div>
        <div class="heading-meta">
          <span>Capacity</span>
          <strong>1 local run</strong>
        </div>
      </section>

      <section class="metric-grid" aria-label="Mission metrics">
        <article class="metric-card accent-cyan">
          <span>Active Missions</span>
          <strong>${active}</strong>
          <small>${active ? "Work remains in the current frontier" : "No work is currently running"}</small>
        </article>
        <article class="metric-card accent-green">
          <span>Completed locally</span>
          <strong>${completed}</strong>
          <small>Accepted without release</small>
        </article>
        <article class="metric-card accent-violet">
          <span>Audit events</span>
          <strong>${totalEvents}</strong>
          <small>Replayed from local history</small>
        </article>
        <article class="metric-card accent-amber">
          <span>External mutations</span>
          <strong>0</strong>
          <small>Release authority stays closed</small>
        </article>
      </section>

      <section class="section-block">
        <div class="section-heading">
          <div>
            <p class="eyebrow">MISSION QUEUE</p>
            <h2>Current Missions</h2>
          </div>
          <span class="record-count">${missions.length} record${missions.length === 1 ? "" : "s"}</span>
        </div>
        <div class="mission-grid">${missionCards}</div>
      </section>

      <section class="system-strip" aria-label="Ticket 01 system boundary">
        <div><span class="strip-index">01</span><strong>Brief</strong><small>Human-owned authority</small></div>
        <span class="strip-arrow" aria-hidden="true">→</span>
        <div><span class="strip-index">02</span><strong>Mission Orchestrator</strong><small>Single behavioral seam</small></div>
        <span class="strip-arrow" aria-hidden="true">→</span>
        <div><span class="strip-index">03</span><strong>Event history</strong><small>Immutable local replay</small></div>
      </section>
    `,
    "overview",
  );
}

function renderMissionCard(mission) {
  const currentIndex = lifecycle.findIndex(([status]) => status === mission.status);
  const progress = Math.round(((currentIndex + 1) / lifecycle.length) * 100);
  const lastEvent = mission.events.at(-1);
  const isComplete = mission.status === "COMPLETED";

  return `
    <article class="mission-card">
      <button type="button" data-mission-id="${escapeHtml(mission.id)}" aria-label="Open Mission: ${escapeHtml(mission.brief.goal)}">
        <div class="mission-card-top">
          <span class="risk-badge risk-${escapeHtml(mission.brief.risk)}">${escapeHtml(mission.brief.risk)} risk</span>
          <span class="status-badge ${isComplete ? "status-complete" : ""}"><span></span>${escapeHtml(humanize(mission.status))}</span>
        </div>
        <h3>${escapeHtml(mission.brief.goal)}</h3>
        <p>${escapeHtml(mission.brief.scope)}</p>
        <div class="progress-track" aria-label="${progress}% complete">
          <span style="width: ${progress}%"></span>
        </div>
        <div class="mission-card-bottom">
          <span>${mission.events.length} event${mission.events.length === 1 ? "" : "s"}</span>
          <span>${escapeHtml(formatDate(lastEvent.occurredAt))}</span>
          <strong>Open flow <span aria-hidden="true">↗</span></strong>
        </div>
      </button>
    </article>
  `;
}

function renderMissionDetail(mission) {
  const currentIndex = lifecycle.findIndex(([status]) => status === mission.status);
  const nextAction = mission.allowedActions[0];
  const step = nextAction ? nextSteps[nextAction] : null;
  const latestEvent = mission.events.at(-1);

  renderShell(
    `
      <section class="page-heading detail-heading">
        <div>
          <button class="back-link" type="button" data-route="overview">← Overview</button>
          <p class="eyebrow">MISSION FLOW / ${escapeHtml(mission.id)}</p>
          <h1 id="page-title" tabindex="-1">${escapeHtml(mission.brief.goal)}</h1>
          <p>${escapeHtml(mission.brief.scope)}</p>
        </div>
        <div class="detail-status">
          <span>Current state</span>
          <strong>${escapeHtml(humanize(mission.status))}</strong>
          <small>Context Pack v${mission.contextPackVersion}</small>
        </div>
      </section>

      <section class="flow-panel" aria-labelledby="flow-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">ORDERED LIFECYCLE</p>
            <h2 id="flow-title">Mission Flow</h2>
          </div>
          <span class="record-count">${currentIndex + 1} / ${lifecycle.length} stages</span>
        </div>
        <ol class="lifecycle-lane">
          ${lifecycle
            .map(([status, label], index) => {
              const phase =
                index < currentIndex
                  ? "is-done"
                  : index === currentIndex
                    ? "is-current"
                    : "is-next";
              return `
                <li class="${phase}">
                  <span class="stage-dot">${index < currentIndex ? "✓" : String(index + 1).padStart(2, "0")}</span>
                  <strong>${label}</strong>
                  <small>${humanize(status)}</small>
                </li>
              `;
            })
            .join("")}
        </ol>
      </section>

      <div class="detail-grid">
        <div class="detail-main">
          ${
            step
              ? `
                <section class="action-card" aria-labelledby="next-action-title">
                  <div>
                    <p class="eyebrow">${escapeHtml(step.eyebrow)}</p>
                    <h2 id="next-action-title">${escapeHtml(step.label)}</h2>
                    <p>${escapeHtml(step.description)}</p>
                  </div>
                  <button class="primary-button action-button" type="button" data-run-action="${escapeHtml(nextAction)}">
                    ${escapeHtml(step.label)} <span aria-hidden="true">→</span>
                  </button>
                </section>
              `
              : `
                <section class="completion-card" aria-labelledby="complete-title">
                  <span class="completion-mark" aria-hidden="true">✓</span>
                  <div>
                    <p class="eyebrow">NO-RELEASE OUTCOME</p>
                    <h2 id="complete-title">Mission completed locally.</h2>
                    <p>The owner accepted the outcome. External mutations remain at zero.</p>
                  </div>
                </section>
              `
          }

          <section class="ledger-panel" aria-labelledby="ledger-title">
            <div class="section-heading compact">
              <div>
                <p class="eyebrow">AUDIT LEDGER</p>
                <h2 id="ledger-title">Event history</h2>
              </div>
              <span class="record-count">${mission.events.length} immutable</span>
            </div>
            <ol class="event-ledger">
              ${[...mission.events].reverse().map(renderEvent).join("")}
            </ol>
          </section>
        </div>

        <aside class="brief-panel" aria-labelledby="brief-title">
          <div class="brief-panel-heading">
            <p class="eyebrow">AUTHORITY ENVELOPE</p>
            <h2 id="brief-title">Mission Brief</h2>
          </div>
          ${renderBriefField("Goal", mission.brief.goal)}
          ${renderBriefField("Scope", mission.brief.scope)}
          ${renderBriefList("Acceptance criteria", mission.brief.acceptanceCriteria)}
          ${renderBriefList("Constraints", mission.brief.constraints)}
          <div class="brief-pair">
            ${renderBriefField("Risk", mission.brief.risk)}
            ${renderBriefField("Release", mission.brief.releaseRequired ? "Required" : "Not required")}
          </div>
          ${renderBriefField("Mutation authority", mission.brief.mutationAuthority)}
          ${renderBriefField("Release authority", mission.brief.releaseAuthority)}
          <div class="brief-version">
            <span>Last event</span>
            <strong>#${latestEvent.sequence} · ${escapeHtml(formatDate(latestEvent.occurredAt))}</strong>
          </div>
        </aside>
      </div>
    `,
    "detail",
  );
}

function renderEvent(event) {
  return `
    <li>
      <span class="event-sequence">${String(event.sequence).padStart(2, "0")}</span>
      <div class="event-copy">
        <div>
          <strong>${escapeHtml(humanize(event.type))}</strong>
          <span>${escapeHtml(event.actor || "system")}</span>
        </div>
        <p>${escapeHtml(event.reason || "No reason recorded")}</p>
        ${
          event.evidenceRefs.length
            ? `<ul class="evidence-list">${event.evidenceRefs.map((ref) => `<li>${escapeHtml(ref)}</li>`).join("")}</ul>`
            : ""
        }
      </div>
      <time datetime="${escapeHtml(event.occurredAt)}">${escapeHtml(formatDate(event.occurredAt))}</time>
    </li>
  `;
}

function renderBriefField(label, value) {
  return `
    <div class="brief-field">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderBriefList(label, values) {
  return `
    <div class="brief-field">
      <span>${escapeHtml(label)}</span>
      <ul>${values.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>
    </div>
  `;
}

function renderBriefDialog() {
  return `
    <dialog class="brief-dialog" id="brief-dialog" aria-labelledby="brief-dialog-title">
      <form method="dialog" class="brief-form" id="brief-form">
        <div class="dialog-heading">
          <div>
            <p class="eyebrow">NEW LOCAL MISSION</p>
            <h2 id="brief-dialog-title">Define the authority envelope.</h2>
            <p>A complete Brief is required before the Orchestrator emits an event.</p>
          </div>
          <button class="close-button" type="button" data-close-brief aria-label="Close Brief form">×</button>
        </div>

        <div class="form-grid">
          <label class="field span-2">
            <span>Goal</span>
            <input name="goal" required placeholder="What outcome must this Mission achieve?" />
          </label>
          <label class="field span-2">
            <span>Scope</span>
            <textarea name="scope" required rows="3" placeholder="What is inside this Mission?"></textarea>
          </label>
          <label class="field">
            <span>Acceptance criteria</span>
            <textarea name="acceptanceCriteria" required rows="5" placeholder="One observable criterion per line"></textarea>
          </label>
          <label class="field">
            <span>Constraints</span>
            <textarea name="constraints" required rows="5" placeholder="One boundary per line"></textarea>
          </label>
          <label class="field">
            <span>Risk</span>
            <select name="risk" required>
              <option value="low">Low</option>
              <option value="medium" selected>Medium</option>
              <option value="high">High</option>
            </select>
          </label>
          <label class="field">
            <span>Mutation authority</span>
            <input name="mutationAuthority" required value="Local Mission Control storage only" />
          </label>
          <label class="field">
            <span>Release requirement</span>
            <select name="releaseRequired" required>
              <option value="false" selected>No release — local completion</option>
            </select>
          </label>
          <label class="field">
            <span>Release authority</span>
            <input name="releaseAuthority" required value="Mission owner" />
          </label>
        </div>

        <div class="dialog-actions">
          <span><span class="pulse-dot" aria-hidden="true"></span> Stored on this device</span>
          <div>
            <button class="secondary-button" type="button" data-close-brief>Cancel</button>
            <button class="primary-button" type="submit">Create Mission</button>
          </div>
        </div>
      </form>
    </dialog>
  `;
}

function wireShellEvents() {
  document.querySelectorAll("[data-route='overview']").forEach((button) => {
    button.addEventListener("click", () => setActiveMission(null));
  });
  document.querySelectorAll("[data-route='detail']").forEach((button) => {
    button.addEventListener("click", () => {
      const mission = getMissions()[0];
      if (mission) setActiveMission(mission.id);
    });
  });
  document.querySelectorAll("[data-mission-id]").forEach((button) => {
    button.addEventListener("click", () =>
      setActiveMission(button.dataset.missionId),
    );
  });
  document.querySelectorAll("[data-open-brief]").forEach((button) => {
    button.addEventListener("click", () =>
      document.querySelector("#brief-dialog").showModal(),
    );
  });
  document.querySelectorAll("[data-close-brief]").forEach((button) => {
    button.addEventListener("click", () =>
      document.querySelector("#brief-dialog").close(),
    );
  });

  document
    .querySelector("#brief-form")
    .addEventListener("submit", handleCreateMission);

  document.querySelector("[data-run-action]")?.addEventListener("click", (event) => {
    const action = event.currentTarget.dataset.runAction;
    advanceMission(action);
  });
}

async function handleCreateMission(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const lines = (name) =>
    String(form.get(name))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  try {
    const mission = await orchestrator.createMission({
      brief: {
        goal: String(form.get("goal")).trim(),
        scope: String(form.get("scope")).trim(),
        acceptanceCriteria: lines("acceptanceCriteria"),
        constraints: lines("constraints"),
        risk: String(form.get("risk")),
        mutationAuthority: String(form.get("mutationAuthority")).trim(),
        releaseRequired: form.get("releaseRequired") === "true",
        releaseAuthority: String(form.get("releaseAuthority")).trim(),
      },
      actor: "mission-owner",
      reason: "Mission owner submitted a complete local Brief",
    });
    notice = { kind: "success", message: "Mission created from an accepted Brief." };
    document.querySelector("#brief-dialog").close();
    setActiveMission(mission.id);
  } catch (error) {
    notice = { kind: "error", message: error.message };
    render();
  }
}

async function advanceMission(action) {
  const mission = orchestrator.getMission(activeMissionId);
  const step = nextSteps[action];
  if (!step) return;

  try {
    const updated = await orchestrator.execute(mission.id, {
      type: MISSION_COMMAND_BY_ACTION[action],
      payload: step.payload(mission),
      actor: "mission-owner",
      reason: step.reason,
      evidenceRefs: step.evidenceRefs,
    });
    notice = {
      kind: "success",
      message:
        updated.status === "COMPLETED"
          ? "No-release outcome accepted. Mission completed locally."
          : `${step.label} recorded as event #${updated.events.length}.`,
    };
  } catch (error) {
    notice = { kind: "error", message: error.message };
  }
  render();
  focusCurrentView();
}

function render() {
  const missions = getMissions();
  const mission = activeMissionId
    ? missions.find((item) => item.id === activeMissionId)
    : null;

  if (activeMissionId && !mission) {
    activeMissionId = null;
    notice = {
      kind: "error",
      message: "That Mission was not found in local event history.",
    };
  }

  if (mission) {
    renderMissionDetail(mission);
  } else {
    renderOverview();
  }
}

window.addEventListener("popstate", () => {
  activeMissionId = new URL(window.location.href).searchParams.get("mission");
  render();
  focusCurrentView();
});

render();
