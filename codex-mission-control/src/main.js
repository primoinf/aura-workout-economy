import {
  MISSION_COMMAND_BY_ACTION,
  createBrowserWriteCoordinator,
  createLocalStorageEventStore,
  createMissionOrchestrator,
} from "./mission-orchestrator.js";
import {
  deriveApprovalRoomModel,
  deriveCommandDeckModel,
  deriveMissionFlowModel,
} from "./mission-presenter.js";
import {
  createMissionWhenHistoryReadable,
  readMissionHistory,
} from "./mission-history-guard.js";
import { createAgentRoutingAdapter } from "./agent-routing-adapter.js";
import {
  buildApprovalDecisionCommand,
  escapeHtml,
  formatDate,
  humanize,
  renderApprovalRoomContent,
} from "./approval-room-view.js";

const agentTransport = globalThis.codexAgentTransport ?? null;
const agentRouter = agentTransport
  ? createAgentRoutingAdapter({ transport: agentTransport })
  : null;
const agentRoutingConnected = Boolean(agentRouter);
const orchestrator = createMissionOrchestrator({
  eventStore: createLocalStorageEventStore(),
  writeCoordinator: createBrowserWriteCoordinator(),
  agentRouter,
});

const app = document.querySelector("#app");

function localEventRef(mission, kind) {
  return `local://missions/${mission.id}/context-${mission.contextPackVersion}/${kind}-event-${mission.events.length + 1}`;
}

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
    description:
      "Approve one bounded Assignment followed by review and validation.",
    reason: "Accepted the bounded no-release execution plan",
    payload: (mission) => {
      const authority = mission.brief.mutationAuthority;
      const workspaceWrite = authority
        .toLowerCase()
        .startsWith("workspace-write:");
      const authorizedRoots = workspaceWrite
        ? authority
            .slice("workspace-write:".length)
            .split(",")
            .map((path) => path.trim())
            .filter(Boolean)
        : ["codex-mission-control"];
      return {
      plan: {
          steps: [
            "Route one bounded Assignment",
            "Independent review",
            "Validation",
            "Learning",
          ],
          assignment: {
            id: `assignment:${mission.id}:context-${mission.contextPackVersion}`,
            goal: mission.brief.goal,
            acceptanceCriteria: mission.brief.acceptanceCriteria,
            contextSlice: mission.context,
            ownershipBoundary: {
              readPaths: authorizedRoots,
              writePaths: workspaceWrite ? authorizedRoots : [],
            },
            effectivePermission: workspaceWrite
              ? "workspace-write"
              : "read-only",
            budget: { maxTurns: 4, maxMinutes: 15 },
            expectedEvidence: mission.brief.acceptanceCriteria,
            workKind: workspaceWrite ? "implementation" : "deterministic",
            risk: mission.brief.risk,
          },
      },
      };
    },
    evidenceRefs: [],
  },
  start_run: {
    label: agentRoutingConnected
      ? "Route Bounded Assignment"
      : "Start Mock Run",
    eyebrow: "Run",
    description: agentRoutingConnected
      ? "Dispatch the declared Assignment through the connected Codex transport."
      : "Start the explicit Ticket 01 local mock while agent transport is disconnected.",
    reason: agentRoutingConnected
      ? "Dispatched the planned bounded Assignment"
      : "Started the bounded local mock run",
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
    payload: (mission) => {
      const reference = localEventRef(mission, "artifact");
      return {
        artifact: {
          name: `Mission Control candidate ${mission.events.length + 1}`,
          uri: reference,
          summary: "Local event-backed candidate manifest",
          content: JSON.stringify(
            {
              candidateType: "mission-control-event-backed",
              missionId: mission.id,
              contextPackVersion: mission.contextPackVersion,
              sourceRef: reference,
              externalMutation: "none",
            },
            null,
            2,
          ),
        },
      };
    },
    evidenceRefs: (mission) => [localEventRef(mission, "artifact-evidence")],
  },
  pass_review: {
    label: "Pass Review",
    eyebrow: "Review Gate",
    description: "Record a mocked independent review with no material findings.",
    reason: "Mock independent review found no material issues",
    payload: (mission) => ({
      review: {
        summary: "No material correctness or security findings",
        details: {
          gate: "Review Gate",
          candidateRef: mission.artifact?.uri ?? null,
          evidenceRef: localEventRef(mission, "review-pass"),
          outcome: "passed",
          method: "Local event-backed review",
        },
      },
    }),
    evidenceRefs: (mission) => [localEventRef(mission, "review-pass")],
  },
  reject_review: {
    label: "Request Review Changes",
    eyebrow: "Review Gate",
    description:
      "Record a distinct review failure and return the candidate to correction.",
    reason: "Independent review requested an idempotency correction",
    payload: () => ({
      review: {
        summary: "Review found a correction that must be resolved",
        findings: ["Regenerate the affected Artifact and Evidence"],
      },
    }),
    evidenceRefs: (mission) => [localEventRef(mission, "review-failure")],
  },
  pass_validation: {
    label: "Pass Validation",
    eyebrow: "Validation Gate",
    description: "Record passing local acceptance evidence.",
    reason: "Local acceptance validation passed",
    payload: (mission) => ({
      validation: {
        summary: "Lifecycle and replay acceptance checks passed",
        details: {
          gate: "Validation Gate",
          candidateRef: mission.artifact?.uri ?? null,
          evidenceRef: localEventRef(mission, "validation-pass"),
          outcome: "passed",
          checks: [
            "Lifecycle transition is replayable",
            "Current Artifact and gate Evidence are present",
          ],
        },
      },
    }),
    evidenceRefs: (mission) => [localEventRef(mission, "validation-pass")],
  },
  fail_validation: {
    label: "Fail Validation",
    eyebrow: "Validation Gate",
    description:
      "Record a validation-specific failure and return the candidate to correction.",
    reason: "Acceptance validation found a replay regression",
    payload: () => ({
      validation: {
        summary: "Validation found a correction that must be resolved",
        failures: ["Regenerate the candidate against current acceptance checks"],
      },
    }),
    evidenceRefs: (mission) => [
      localEventRef(mission, "validation-failure"),
    ],
  },
  start_correction: {
    label: "Start Correction",
    eyebrow: "Correction Run",
    description:
      "Return the requested changes to the assigned role and invalidate the prior candidate.",
    reason: "Returned the requested changes to the assigned role",
    payload: (mission) => ({
      run: {
        id: `correction:${mission.id}:event-${mission.events.length + 1}`,
        agentRole: mission.agent?.roleId ?? "terra_builder",
        mode: "local-correction",
      },
    }),
    evidenceRefs: [],
  },
  revise_context: {
    label: "Revise Context",
    eyebrow: "Context Pack",
    description:
      "Create a new material Context Pack version and invalidate downstream candidate Evidence.",
    reason: "Material Context changed; downstream Evidence was invalidated",
    payload: (mission) => ({
      context: {
        summary: `Revised Context Pack v${mission.contextPackVersion + 1} for ${mission.brief.goal}`,
        sourceRefs: [
          ...(mission.context?.sourceRefs ?? []),
          localEventRef(mission, "context-revision"),
        ],
      },
    }),
    evidenceRefs: [],
  },
  block_mission: {
    label: "Block Mission",
    eyebrow: "Control State",
    description:
      "Pause at the current safe state while preserving the blocker and recovery requirement.",
    reason: "Mission owner paused work at the current safe state",
    payload: () => ({
      block: {
        blocker: "Required owner input is not yet available",
        attemptedAlternatives: [
          "Reviewed the current Brief and Context Pack",
          "Kept the active gate unchanged",
        ],
        requiredAuthorityOrInput: "Mission owner input",
      },
    }),
    evidenceRefs: [],
  },
  resume_mission: {
    label: "Resume Mission",
    eyebrow: "Control State",
    description:
      "Resume exactly at the recorded prior safe state without skipping a gate.",
    reason: "Mission owner supplied the required input",
    payload: () => ({
      resumption: { summary: "Required owner input is now available" },
    }),
    evidenceRefs: [],
  },
  cancel_mission: {
    label: "Cancel Mission",
    eyebrow: "Terminal Control",
    description:
      "End this Mission without deleting its immutable event history.",
    reason: "Mission owner cancelled the local Mission",
    payload: () => ({
      cancellation: { summary: "Mission is no longer required" },
    }),
    evidenceRefs: [],
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
    evidenceRefs: (mission) => [localEventRef(mission, "learning")],
  },
  complete_no_release: {
    label: "Accept No-Release Outcome",
    eyebrow: "Human Decision",
    description: "Complete locally. No commit, push, PR, or deployment occurs.",
    reason: "Mission owner accepted the no-release outcome",
    payload: () => ({
      completion: { summary: "Accepted locally without release" },
    }),
    evidenceRefs: (mission) => [localEventRef(mission, "completion")],
  },
};

const initialUrl = new URL(window.location.href);
let activeMissionId = initialUrl.searchParams.get("mission");
let activeView =
  initialUrl.searchParams.get("view") ??
  (activeMissionId ? "detail" : "overview");
let notice = null;
let historyReadError = null;

function isApprovalRouteAvailable(mission) {
  return (
    mission?.brief.releaseRequired &&
    (["APPROVAL_REQUIRED", "READY_TO_RELEASE"].includes(mission.status) ||
      (mission.status === "CHANGES_REQUESTED" &&
        mission.approval?.decision === "REJECTED"))
  );
}

function setActiveMission(
  missionId,
  view = missionId ? "detail" : "overview",
) {
  activeMissionId = missionId;
  activeView = view;
  const url = new URL(window.location.href);
  if (missionId) {
    url.searchParams.set("mission", missionId);
    url.searchParams.set("view", view);
  } else {
    url.searchParams.delete("mission");
    url.searchParams.delete("view");
  }
  window.history.pushState({}, "", url);
  render();
  focusCurrentView();
}

function focusCurrentView() {
  document.querySelector("#page-title")?.focus();
}

function getMissions() {
  const history = readMissionHistory(orchestrator);
  historyReadError = history.error;
  return history.missions;
}

function renderShell(content, view) {
  const missions = getMissions();
  const commandDeck = deriveCommandDeckModel(missions);
  const selectedMission = missions.find(
    (mission) => mission.id === activeMissionId,
  );
  const approvalAvailable = isApprovalRouteAvailable(selectedMission);

  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Primary navigation">
        <button class="brand" type="button" data-route="overview" aria-label="Codex Mission Control home">
          <span class="brand-mark" aria-hidden="true">⌁</span>
          <span>
            <strong>Mission</strong>
            <small>Control</small>
          </span>
        </button>

        <nav class="nav-list">
          <button class="nav-item ${view === "overview" ? "is-active" : ""}" type="button" data-route="overview" ${view === "overview" ? 'aria-current="page"' : ""}>
            <span class="nav-icon" aria-hidden="true">▦</span>
            <span>ภาพรวม</span>
          </button>
          <button class="nav-item ${view === "detail" ? "is-active" : ""}" type="button" data-route="detail" ${view === "detail" ? 'aria-current="page"' : ""} ${missions.length === 0 ? "disabled" : ""}>
            <span class="nav-icon" aria-hidden="true">◎</span>
            <span>Mission Flow</span>
          </button>
          <button class="nav-item ${view === "approval" ? "is-active" : ""}" type="button" data-route="approval" ${view === "approval" ? 'aria-current="page"' : ""} ${approvalAvailable ? "" : 'disabled title="Available when the selected release Mission requires approval"'}>
            <span class="nav-icon" aria-hidden="true">◇</span>
            <span class="nav-copy"><span>Approval Room</span><small>${approvalAvailable ? "Human decision" : "No decision pending"}</small></span>
          </button>
        </nav>

        <div class="sidebar-team" aria-label="Configured Codex team">
          <span class="sidebar-team-dot ${commandDeck.metrics.agentTelemetry === "Observed" ? "is-observed" : ""}" aria-hidden="true"></span>
          <div>
            <strong>${commandDeck.metrics.configuredAgents} configured roles</strong>
            <small>${commandDeck.metrics.agentTelemetry === "Observed" ? "Assignment / Run observations available" : agentRoutingConnected ? "Agent transport connected · awaiting observations" : "Agent transport disconnected"}</small>
          </div>
        </div>
        <div class="local-mode">
          <span class="pulse-dot" aria-hidden="true"></span>
          <span><strong>Local only</strong><small>No external actions</small></span>
        </div>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <div class="mobile-brand">
            <span class="brand-mark" aria-hidden="true">⌁</span>
            <span>Mission Control</span>
          </div>
          <div class="topbar-copy">
            <span class="system-state"><span class="pulse-dot" aria-hidden="true"></span> Orchestrator ready</span>
            <span class="storage-state">Brief → Context → Workflow → Evidence</span>
          </div>
          <button class="new-mission-button" type="button" data-open-brief ${historyReadError ? 'disabled title="Mission creation is disabled until local history can be replayed"' : ""}>
            <span aria-hidden="true">＋</span> สร้าง Mission
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
  const currentHistoryError = historyReadError;
  const model = deriveCommandDeckModel(missions);

  if (currentHistoryError) {
    renderShell(renderHistoryError(currentHistoryError), "overview");
    return;
  }

  const missionCards =
    model.missions.length === 0
      ? `
        <section class="empty-state" aria-labelledby="empty-title">
          <span class="empty-kicker">ZERO STATE</span>
          <h2 id="empty-title">เริ่มจาก Brief ที่มีขอบเขตชัดเจน</h2>
          <p>กำหนด Goal, Context, Acceptance criteria และ Authority ก่อนให้ Orchestrator สร้าง event แรก ระบบนี้ไม่ commit, push หรือ deploy เอง</p>
          <button class="primary-button" type="button" data-open-brief>สร้าง Mission แรก</button>
        </section>
      `
      : model.missions.map(renderMissionCard).join("");
  const signals =
    model.latestSignals.length === 0
      ? `<div class="signal-empty">Event stream จะปรากฏหลัง Brief แรกถูกยอมรับ</div>`
      : model.latestSignals.map(renderSignal).join("");

  renderShell(
    `
      <section class="page-heading command-heading">
        <div>
          <p class="eyebrow">CODEX TEAM / LIVE CONTROL</p>
          <h1 id="page-title" tabindex="-1">ภาพรวมทีม</h1>
          <p>Command Deck สำหรับติดตาม Mission, บทบาทที่ตั้งค่าไว้ และหลักฐานจริงจาก local event history</p>
        </div>
        <div class="heading-meta command-mode">
          <span>Operating mode</span>
          <strong>Local · ${missions.some((mission) => mission.brief.releaseRequired) ? "Human-gated release" : "No release"}</strong>
          <small>Mission Orchestrator v1</small>
        </div>
      </section>

      <section class="metric-grid" aria-label="Mission metrics">
        <article class="metric-card accent-cyan">
          <span>Configured roles</span>
          <strong>${model.metrics.configuredAgents}</strong>
          <small>${model.metrics.agentTelemetry === "Observed" ? "Runtime state replayed from Assignment / Run events" : agentRoutingConnected ? "Transport connected · no Run observations yet" : "No Assignment / Run observations"}</small>
        </article>
        <article class="metric-card accent-green">
          <span>Active Missions</span>
          <strong>${model.metrics.activeMissions}</strong>
          <small>${model.metrics.activeMissions ? "Work remains in the current frontier" : "No Mission is currently active"}</small>
        </article>
        <article class="metric-card accent-violet">
          <span>Completed locally</span>
          <strong>${model.metrics.completedMissions}</strong>
          <small>Accepted no-release outcomes</small>
        </article>
        <article class="metric-card accent-amber">
          <span>Audit events</span>
          <strong>${model.metrics.auditEvents}</strong>
          <small>Immutable records replayed from this device</small>
        </article>
      </section>

      <section class="section-block">
        <div class="section-heading">
          <div>
            <p class="eyebrow">CONFIGURED SQUAD</p>
            <h2>ทีม Codex</h2>
          </div>
          <span class="honesty-note ${model.metrics.agentTelemetry === "Observed" ? "is-observed" : ""}"><span></span> ${model.metrics.agentTelemetry === "Observed" ? "Observed Assignment / Run telemetry" : agentRoutingConnected ? "Transport connected · awaiting Run" : "Configuration only · transport disconnected"}</span>
        </div>
        <div class="team-grid">${model.team.map(renderTeamCard).join("")}</div>
      </section>

      <div class="overview-lower">
        <section class="section-block mission-inventory" aria-labelledby="mission-queue-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">MISSION QUEUE</p>
              <h2 id="mission-queue-title">Current Missions</h2>
            </div>
            <span class="record-count">${model.missions.length} record${model.missions.length === 1 ? "" : "s"}</span>
          </div>
          <div class="mission-grid">${missionCards}</div>
        </section>

        <section class="section-block signal-panel" aria-labelledby="signal-title">
          <div class="section-heading">
            <div>
              <p class="eyebrow">EVENT STREAM</p>
              <h2 id="signal-title">Latest signals</h2>
            </div>
            <span class="live-label"><i></i>Replay</span>
          </div>
          <div class="signal-list">${signals}</div>
        </section>
      </div>

      <section class="system-strip" aria-label="Mission information flow">
        <div><span class="strip-index">01</span><strong>Brief</strong><small>Goal and authority</small></div>
        <span class="strip-arrow" aria-hidden="true">→</span>
        <div><span class="strip-index">02</span><strong>Context</strong><small>Versioned local snapshot</small></div>
        <span class="strip-arrow" aria-hidden="true">→</span>
        <div><span class="strip-index">03</span><strong>Workflow</strong><small>Guarded lifecycle commands</small></div>
        <span class="strip-arrow" aria-hidden="true">→</span>
        <div><span class="strip-index">04</span><strong>Evidence</strong><small>Immutable audit events</small></div>
      </section>
    `,
    "overview",
  );
}

function renderTeamCard(role) {
  const runtimeClass = role.runtimeStatus.toLowerCase();
  const effectivePermission = role.effectivePermission ?? role.permission;
  const modelMetadata = role.modelMetadata
    ? `${role.modelMetadata.name}${role.modelMetadata.reasoningEffort ? ` · ${role.modelMetadata.reasoningEffort}` : ""}`
    : "Model metadata unavailable";
  return `
    <article class="team-card tone-${escapeHtml(role.tone)} runtime-${escapeHtml(runtimeClass)}">
      <div class="team-card-head">
        <span class="team-avatar" aria-hidden="true">${escapeHtml(role.initials)}</span>
        <div>
          <h3>${escapeHtml(role.name)}</h3>
          <p>${escapeHtml(role.role)}</p>
        </div>
        <span class="connection-dot" aria-hidden="true"></span>
      </div>
      <p class="team-capability">${escapeHtml(role.capability)}</p>
      <div class="team-card-meta">
        <span>${escapeHtml(effectivePermission)}</span>
        <strong>${escapeHtml(role.connection)}</strong>
      </div>
      <div class="team-assignment">
        <span>${escapeHtml(role.assignment)}</span>
        <small>${escapeHtml(role.telemetry)}</small>
      </div>
      <div class="team-observation">
        <span>${escapeHtml(modelMetadata)}</span>
        <small>${escapeHtml(role.latestEvidence ?? "No observed Evidence")}</small>
      </div>
    </article>
  `;
}

function renderMissionCard(mission) {
  const isComplete = mission.status === "COMPLETED";
  const statusClass = `status-${mission.status.toLowerCase().replaceAll("_", "-")}`;
  const nextActionLabel = mission.nextAction
    ? nextSteps[mission.nextAction]?.label ?? humanize(mission.nextAction)
    : "No action required";

  return `
    <article class="mission-card">
      <button type="button" data-mission-id="${escapeHtml(mission.id)}" aria-label="Open Mission: ${escapeHtml(mission.goal)}">
        <div class="mission-card-top">
          <span class="risk-badge risk-${escapeHtml(mission.risk)}">${escapeHtml(mission.risk)} risk</span>
          <span class="status-badge ${statusClass} ${isComplete ? "status-complete" : ""}"><span></span>${escapeHtml(humanize(mission.status))}</span>
        </div>
        <h3>${escapeHtml(mission.goal)}</h3>
        <p>${escapeHtml(mission.scope)}</p>
        <div class="progress-copy">
          <span>Lifecycle completion</span>
          <strong>${mission.lifecycleCompletion}%</strong>
        </div>
        <div class="progress-track" aria-label="${mission.lifecycleCompletion}% lifecycle completion">
          <span style="width: ${mission.lifecycleCompletion}%"></span>
        </div>
        <div class="mission-next-action">
          <span>Next allowed action</span>
          <strong>${escapeHtml(nextActionLabel)}</strong>
        </div>
        <div class="mission-card-bottom">
          <span>${mission.eventCount} event${mission.eventCount === 1 ? "" : "s"}</span>
          <span>${escapeHtml(formatDate(mission.latestEvent.occurredAt))}</span>
          <strong>Open flow <span aria-hidden="true">↗</span></strong>
        </div>
      </button>
    </article>
  `;
}

function renderHistoryError(error) {
  return `
    <section class="history-error" role="alert" aria-labelledby="page-title">
      <span class="history-error-mark" aria-hidden="true">!</span>
      <p class="eyebrow">EVENT REPLAY FAILED CLOSED</p>
      <h1 id="page-title" tabindex="-1">Mission history could not be replayed.</h1>
      <p>The Command Deck is withholding derived status because the local event history is malformed or unreadable.</p>
      <div class="history-error-detail">
        <span>Detected problem</span>
        <code>${escapeHtml(error?.message ?? "Unknown local event history error")}</code>
      </div>
      <p class="history-error-guidance">No Mission data was changed. Back up or repair <code>codex-mission-control-events-v1</code>, then reload this page.</p>
    </section>
  `;
}

function renderSignal(signal) {
  return `
    <article class="signal-item">
      <span class="signal-sequence">${String(signal.sequence).padStart(2, "0")}</span>
      <div>
        <strong>${escapeHtml(humanize(signal.type))}</strong>
        <p>${escapeHtml(signal.reason)}</p>
        <small>${escapeHtml(signal.missionGoal)} · ${escapeHtml(signal.actor)}</small>
      </div>
      <time datetime="${escapeHtml(signal.occurredAt)}">${escapeHtml(formatDate(signal.occurredAt))}</time>
    </article>
  `;
}

function renderMissionDetail(mission) {
  const flow = deriveMissionFlowModel(mission);
  const approvalRouteAvailable = isApprovalRouteAvailable(mission);
  const approvalRejected =
    mission.status === "CHANGES_REQUESTED" &&
    mission.approval?.decision === "REJECTED";
  const missionActions = mission.allowedActions.filter(
    (action) =>
      !["approve_release", "reject_release"].includes(action),
  );
  const nextAction = approvalRouteAvailable
    ? null
    : (missionActions[0] ?? null);
  const step = nextAction ? nextSteps[nextAction] : null;
  const secondaryActions = missionActions
    .slice(approvalRouteAvailable ? 0 : 1)
    .map((action) => ({ action, step: nextSteps[action] }))
    .filter((item) => item.step);
  const latestEvent = mission.events.at(-1);
  const statusClass = `status-${mission.status.toLowerCase().replaceAll("_", "-")}`;
  const isControlState = [
    "changes-requested",
    "blocked",
    "resumed",
    "cancelled",
  ].includes(flow.visualState.kind);

  renderShell(
    `
      <section class="mission-hero state-${escapeHtml(flow.visualState.kind)}">
        <div class="mission-hero-copy">
          <button class="back-link" type="button" data-route="overview">← Overview</button>
          <p class="eyebrow">${escapeHtml(mission.id)} · EXECUTION FLOW</p>
          <h1 id="page-title" tabindex="-1">${escapeHtml(mission.brief.goal)}</h1>
          <p>${escapeHtml(mission.brief.scope)}</p>
          <div class="mission-hero-meta">
            <span class="status-badge ${statusClass} ${mission.status === "COMPLETED" ? "status-complete" : ""}"><span></span>${escapeHtml(humanize(mission.status))}</span>
            <span>Context Pack v${mission.contextPackVersion}</span>
            <span>${mission.events.length} events</span>
            <span>${flow.evidenceCount} Evidence refs</span>
          </div>
        </div>
        <div class="completion-orbit" style="--completion: ${flow.lifecycleCompletion}%">
          <div>
            <strong>${flow.lifecycleCompletion}</strong><span>%</span>
            <small>Lifecycle<br />completion</small>
          </div>
        </div>
      </section>

      ${
        isControlState
          ? `
            <section class="control-state-banner state-${escapeHtml(flow.visualState.kind)}" aria-labelledby="control-state-title">
              <div class="control-state-mark" aria-hidden="true">${flow.visualState.kind === "cancelled" ? "×" : flow.visualState.kind === "resumed" ? "↺" : "!"}</div>
              <div>
                <p class="eyebrow">${escapeHtml(flow.visualState.source ? `${flow.visualState.source} CONTROL` : "MISSION CONTROL")}</p>
                <h2 id="control-state-title">${escapeHtml(flow.visualState.label)}</h2>
                <p>${escapeHtml(flow.visualState.summary)}</p>
                <div class="control-state-meta">
                  <span>Prior safe state <strong>${escapeHtml(humanize(flow.visualState.priorSafeState ?? "not applicable"))}</strong></span>
                  ${
                    mission.block
                      ? `<span>Required input <strong>${escapeHtml(mission.block.requiredAuthorityOrInput)}</strong></span>`
                      : ""
                  }
                  ${
                    mission.changeRequest
                      ? `<span>Failure Evidence <strong>${escapeHtml(mission.changeRequest.evidenceRefs.join(", "))}</strong></span>`
                      : ""
                  }
                </div>
              </div>
            </section>
          `
          : ""
      }

      <section class="flow-panel" aria-labelledby="flow-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">ORDERED LIFECYCLE</p>
            <h2 id="flow-title">Mission Flow</h2>
          </div>
          <span class="record-count">${flow.currentStage.position} / ${flow.currentStage.total} stages</span>
        </div>
        <ol class="lifecycle-lane">
          ${flow.stages
            .map(
              (stage) => `
                <li class="is-${stage.state}" ${stage.state !== "done" && stage.state !== "locked" ? 'aria-current="step"' : ""}>
                  <span class="stage-dot">${stage.state === "done" ? "✓" : String(stage.number).padStart(2, "0")}</span>
                  <strong>${escapeHtml(stage.label)}</strong>
                  <small>${escapeHtml(humanize(stage.status))}</small>
                </li>
              `,
            )
            .join("")}
        </ol>
      </section>

      <section class="agent-lanes-panel" aria-labelledby="agent-lanes-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">CONFIGURED HAND-OFFS</p>
            <h2 id="agent-lanes-title">Agent lanes</h2>
          </div>
          <span class="honesty-note ${mission.agent ? "is-observed" : ""}"><span></span> ${mission.agent ? "Replayed Assignment / Run observations" : "No Assignment / Run observations"}</span>
        </div>
        <div class="agent-lanes">
          ${flow.team.map(renderAgentLane).join("")}
        </div>
      </section>

      <div class="detail-grid">
        <div class="detail-main">
          ${
            approvalRouteAvailable
              ? `
                <section class="action-card approval-entry-card" aria-labelledby="next-action-title">
                  <div>
                    <p class="eyebrow">HUMAN RELEASE GATE</p>
                    <h2 id="next-action-title">${mission.status === "APPROVAL_REQUIRED" ? "Review the exact release candidate" : approvalRejected ? "Review the rejected release snapshot" : "Release readiness recorded"}</h2>
                    <p>${mission.status === "APPROVAL_REQUIRED" ? "Open the Review Ledger to inspect current Evidence, residual risk, external action, and rollback commitment before deciding." : approvalRejected ? "Inspect the immutable rejected candidate and rationale. No release or deployment has occurred." : "Inspect the immutable human decision. No release or deployment has occurred."}</p>
                  </div>
                  <button class="primary-button action-button" type="button" data-route="approval">
                    Open Approval Room <span aria-hidden="true">→</span>
                  </button>
                </section>
                ${
                  secondaryActions.length
                    ? `
                      <section class="control-actions-panel" aria-labelledby="control-actions-title">
                        <div>
                          <p class="eyebrow">OTHER ALLOWED ACTIONS</p>
                          <h2 id="control-actions-title">Mission controls</h2>
                        </div>
                        <div class="control-actions">
                          ${secondaryActions
                            .map(
                              ({ action, step: secondaryStep }) => `
                                <button class="secondary-button ${action === "cancel_mission" ? "danger-button" : ""}" type="button" data-run-action="${escapeHtml(action)}" title="${escapeHtml(secondaryStep.description)}">
                                  ${escapeHtml(secondaryStep.label)}
                                </button>
                              `,
                            )
                            .join("")}
                        </div>
                      </section>
                    `
                    : ""
                }
              `
              : step
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
                ${
                  secondaryActions.length
                    ? `
                      <section class="control-actions-panel" aria-labelledby="control-actions-title">
                        <div>
                          <p class="eyebrow">OTHER ALLOWED ACTIONS</p>
                          <h2 id="control-actions-title">Mission controls</h2>
                        </div>
                        <div class="control-actions">
                          ${secondaryActions
                            .map(
                              ({ action, step: secondaryStep }) => `
                                <button class="secondary-button ${action === "cancel_mission" ? "danger-button" : ""}" type="button" data-run-action="${escapeHtml(action)}" title="${escapeHtml(secondaryStep.description)}">
                                  ${escapeHtml(secondaryStep.label)}
                                </button>
                              `,
                            )
                            .join("")}
                        </div>
                      </section>
                    `
                    : ""
                }
              `
              : mission.status === "CANCELLED"
                ? `
                  <section class="completion-card cancellation-card" aria-labelledby="complete-title">
                    <span class="completion-mark" aria-hidden="true">×</span>
                    <div>
                      <p class="eyebrow">TERMINAL CONTROL</p>
                      <h2 id="complete-title">Mission cancelled.</h2>
                      <p>${escapeHtml(mission.cancellation.summary)} Its immutable history remains available below.</p>
                    </div>
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
          ${renderBriefField("Release authorized", mission.brief.releaseAuthorized === true ? "Explicitly authorized" : "Not authorized")}
          ${
            mission.brief.releaseRequired
              ? `
                ${renderBriefField("Residual risk", mission.brief.releasePlan.residualRisk)}
                ${renderBriefField("External action", mission.brief.releasePlan.intendedExternalAction)}
                ${renderBriefField("Rollback", mission.brief.releasePlan.rollbackCommitment)}
              `
              : ""
          }
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

function renderApprovalRoom(mission) {
  const model = deriveApprovalRoomModel(mission);
  renderShell(renderApprovalRoomContent(model), "approval");
}

function renderAgentLane(role) {
  const runtimeClass = role.runtimeStatus.toLowerCase();
  return `
    <article class="agent-lane tone-${escapeHtml(role.tone)} runtime-${escapeHtml(runtimeClass)}">
      <span class="team-avatar" aria-hidden="true">${escapeHtml(role.initials)}</span>
      <div class="agent-lane-copy">
        <strong>${escapeHtml(role.name)}</strong>
        <small>${escapeHtml(role.effectivePermission ?? role.permission)} · ${escapeHtml(role.capability)}</small>
      </div>
      <div class="lane-track" aria-hidden="true"><span></span></div>
      <span class="lane-state">${escapeHtml(role.assignment)}</span>
      <span class="lane-connection">${escapeHtml(role.runtimeStatus === "DISCONNECTED" ? role.connection : `${role.runtimeStatus}${role.elapsedTime ? ` · ${role.elapsedTime}` : ""}`)}</span>
    </article>
  `;
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
          event.data?.approval?.summary
            ? `<p class="event-decision-rationale"><strong>Human rationale:</strong> ${escapeHtml(event.data.approval.summary)}</p>`
            : ""
        }
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
              <option value="true">Human approval required</option>
            </select>
          </label>
          <label class="field">
            <span>Release authority</span>
            <input name="releaseAuthority" required value="mission-owner" />
          </label>
          <label class="field">
            <span>Release authorization</span>
            <select name="releaseAuthorized" required>
              <option value="false" selected>Not authorized</option>
              <option value="true">Explicitly authorized</option>
            </select>
          </label>
          <label class="field span-2">
            <span>Residual risk if release is required</span>
            <input name="residualRisk" value="A failed release may require rollback" />
          </label>
          <label class="field">
            <span>Intended external action</span>
            <textarea name="intendedExternalAction" rows="3">Deploy only the exact approved candidate</textarea>
          </label>
          <label class="field">
            <span>Rollback commitment</span>
            <textarea name="rollbackCommitment" rows="3">Restore the previous immutable release</textarea>
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
      const mission =
        getMissions().find((item) => item.id === activeMissionId) ??
        getMissions()[0];
      if (mission) setActiveMission(mission.id, "detail");
    });
  });
  document.querySelectorAll("[data-route='approval']").forEach((button) => {
    button.addEventListener("click", () => {
      const mission = getMissions().find(
        (item) => item.id === activeMissionId,
      );
      if (isApprovalRouteAvailable(mission)) {
        setActiveMission(mission.id, "approval");
      }
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
  document
    .querySelector("#approval-decision-form")
    ?.addEventListener("submit", handleApprovalDecision);

  document.querySelectorAll("[data-run-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.runAction;
      advanceMission(action);
    });
  });
}

async function handleApprovalDecision(event) {
  event.preventDefault();
  const mission = orchestrator.getMission(activeMissionId);
  const summary = String(
    new FormData(event.currentTarget).get("approvalSummary"),
  ).trim();
  const decision = event.submitter?.value;

  try {
    const updated = await orchestrator.execute(
      mission.id,
      buildApprovalDecisionCommand(mission, { decision, summary }),
    );
    notice = {
      kind: "success",
      message:
        decision === "approve"
          ? "Release readiness approved. No external action was executed."
          : "Release rejected and returned to changes requested.",
    };
    setActiveMission(
      updated.id,
      decision === "approve" ? "approval" : "detail",
    );
  } catch (error) {
    notice = { kind: "error", message: error.message };
    render();
  }
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
    const releaseRequired = form.get("releaseRequired") === "true";
    const mission = await createMissionWhenHistoryReadable(orchestrator, {
      brief: {
        goal: String(form.get("goal")).trim(),
        scope: String(form.get("scope")).trim(),
        acceptanceCriteria: lines("acceptanceCriteria"),
        constraints: lines("constraints"),
        risk: String(form.get("risk")),
        mutationAuthority: String(form.get("mutationAuthority")).trim(),
        releaseRequired,
        releaseAuthorized:
          releaseRequired &&
          form.get("releaseAuthorized") === "true",
        releaseAuthority: String(form.get("releaseAuthority")).trim(),
        ...(releaseRequired
          ? {
              releasePlan: {
                residualRisk: String(form.get("residualRisk")).trim(),
                intendedExternalAction: String(
                  form.get("intendedExternalAction"),
                ).trim(),
                rollbackCommitment: String(
                  form.get("rollbackCommitment"),
                ).trim(),
              },
            }
          : {}),
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
  if (
    action === "cancel_mission" &&
    !window.confirm(
      "Cancel this Mission? The event history will remain readable, but cancellation is terminal.",
    )
  ) {
    return;
  }

  try {
    const evidenceRefs =
      typeof step.evidenceRefs === "function"
        ? step.evidenceRefs(mission)
        : step.evidenceRefs;
    const updated =
      action === "start_run" && agentRoutingConnected
        ? await orchestrator.dispatchAssignment(mission.id, {
            assignment: mission.plan.assignment,
            actor: "mission-owner",
            reason: step.reason,
          })
        : action === "start_correction" &&
            agentRoutingConnected &&
            mission.assignment
          ? await orchestrator.dispatchCorrection(mission.id, {
              actor: "mission-owner",
              reason: step.reason,
            })
        : await orchestrator.execute(mission.id, {
            type: MISSION_COMMAND_BY_ACTION[action],
            payload: step.payload(mission),
            actor: "mission-owner",
            reason: step.reason,
            evidenceRefs,
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
  if (historyReadError) {
    renderOverview();
    return;
  }
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
    if (
      activeView === "approval" &&
      isApprovalRouteAvailable(mission)
    ) {
      renderApprovalRoom(mission);
    } else {
      activeView = "detail";
      renderMissionDetail(mission);
    }
  } else {
    activeView = "overview";
    renderOverview();
  }
}

window.addEventListener("popstate", () => {
  const url = new URL(window.location.href);
  activeMissionId = url.searchParams.get("mission");
  activeView =
    url.searchParams.get("view") ??
    (activeMissionId ? "detail" : "overview");
  render();
  focusCurrentView();
});

render();
