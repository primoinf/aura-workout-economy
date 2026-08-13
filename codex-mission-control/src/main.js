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
import { renderTaskExecutionContent } from "./execution-room-view.js";
import { nextDecisionRoomInput } from "./task-graph-execution.js";

const liveAgentTransport = globalThis.codexAgentTransport ?? null;
const localObservedTransport = {
  async *run({ roleId, assignment, reviewContext }) {
    const runId = `local-run:${assignment.id}:${crypto.randomUUID()}`;
    const startedAt = new Date().toISOString();
    yield {
      kind: "started",
      runId,
      occurredAt: startedAt,
      model: {
        name: "local-observed-simulator",
        reasoningEffort: "deterministic",
      },
    };
    const completedAt = new Date().toISOString();
    const artifactUri = `local://assignments/${assignment.id}/${runId}`;
    const evidenceRef = `${artifactUri}/evidence`;
    yield {
      kind: "completed",
      runId,
      occurredAt: completedAt,
      summary: `${roleId} completed ${assignment.id} in the local observable simulator`,
      artifacts: [
        {
          name:
            assignment.workKind === "review"
              ? `Review report for ${assignment.id}`
              : `Candidate output for ${assignment.id}`,
          uri: artifactUri,
          summary: `Event-backed local output from ${roleId}`,
          content: JSON.stringify(
            {
              assignmentId: assignment.id,
              roleId,
              runId,
              externalMutation: "none",
            },
            null,
            2,
          ),
          ...(assignment.workKind === "review"
            ? {
                reviewOutcome: {
                  outcome: "PASSED",
                  candidateArtifactRefs:
                    reviewContext?.candidateArtifactRefs ?? [],
                  findings: [],
                },
              }
            : {}),
        },
      ],
      evidence: [
        {
          ref: evidenceRef,
          kind: assignment.workKind === "review" ? "review" : "local-run",
          summary: `Observed ${assignment.workKind} completion from ${roleId}`,
        },
      ],
    };
  },
};
const agentRouter = createAgentRoutingAdapter({
  transport: liveAgentTransport ?? localObservedTransport,
});
const agentRoutingConnected = Boolean(liveAgentTransport);
const eventStore = createLocalStorageEventStore();
const orchestrator = createMissionOrchestrator({
  eventStore,
  writeCoordinator: createBrowserWriteCoordinator(),
  agentRouter,
});

const app = document.querySelector("#app");

function localEventRef(mission, kind) {
  return `local://missions/${mission.id}/context-${mission.contextPackVersion}/${kind}-event-${mission.events.length + 1}`;
}

function decisionRoomInputForMission(mission) {
  const input = nextDecisionRoomInput(mission.execution);
  if (!input) {
    throw new Error("No Decision Room Assignment is awaiting input.");
  }
  return {
    assignmentId: input.assignmentId,
    evidenceRefs:
      input.evidenceRefs.length > 0
        ? input.evidenceRefs
        : [localEventRef(mission, "decision-input-evidence")],
  };
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
      "Approve a dependency-aware Task Graph with bounded ownership and independent review.",
    reason: "Accepted the safe multi-agent execution plan",
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
      const assignment = (id, goal, overrides = {}) => ({
        id: `${id}:${mission.id}:context-${mission.contextPackVersion}`,
        goal,
        acceptanceCriteria: mission.brief.acceptanceCriteria,
        contextSlice: mission.context,
        ownershipBoundary: {
          readPaths: authorizedRoots,
          writePaths: [],
        },
        effectivePermission: "read-only",
        budget: { maxTurns: 4, maxMinutes: 15 },
        expectedEvidence: mission.brief.acceptanceCriteria,
        workKind: "deterministic",
        risk: "low",
        dependsOn: [],
        ...overrides,
      });
      const inspectId = `inspect:${mission.id}:context-${mission.contextPackVersion}`;
      const decisionId = `architect:${mission.id}:context-${mission.contextPackVersion}`;
      const buildId = `build:${mission.id}:context-${mission.contextPackVersion}`;
      return {
        plan: {
          steps: [
            "Inspect bounded Context",
            "Resolve consequential architecture judgment",
            "Build within declared ownership",
            "Independent review",
            "Validation",
            "Learning",
          ],
          taskGraph: {
            capacity: 4,
            coordinationRequired: true,
            assignments: [
              assignment(
                "inspect",
                `Inspect the bounded Context for ${mission.brief.goal}`,
              ),
              assignment(
                "architect",
                "Choose the safest implementation seam",
                {
                  dependsOn: [inspectId],
                  workKind: "architecture",
                  risk: "high",
                  requiresDecision: true,
                },
              ),
              assignment("build", mission.brief.goal, {
                dependsOn: [inspectId, decisionId],
                workKind: workspaceWrite ? "implementation" : "deterministic",
                risk: workspaceWrite ? "medium" : "low",
                effectivePermission: workspaceWrite
                  ? "workspace-write"
                  : "read-only",
                ownershipBoundary: {
                  readPaths: authorizedRoots,
                  writePaths: workspaceWrite ? authorizedRoots : [],
                },
              }),
              assignment(
                "review",
                "Independently review the completed candidate",
                {
                  dependsOn: [buildId],
                  workKind: "review",
                  risk: "high",
                  expectedEvidence: [
                    "Findings identify a triggering scenario and owner",
                  ],
                },
              ),
            ],
          },
        },
      };
    },
    evidenceRefs: [],
  },
  open_decision_room: {
    label: "Open Decision Room",
    eyebrow: "Consequential Judgment",
    description:
      "Record the question, participants, Evidence, alternatives, trade-offs, recommendation, and validation plan.",
    reason: "Opened a structured Decision Room for consequential work",
    payload: () => {
      throw new Error(
        "Decision Room input must be submitted through the structured form.",
      );
    },
    evidenceRefs: (mission) =>
      decisionRoomInputForMission(mission).evidenceRefs,
  },
  resolve_decision_room: {
    label: "Resolve Decision Room",
    eyebrow: "Human Decision",
    description:
      "Select the recorded recommendation with an explicit human rationale.",
    reason: "Mission owner resolved the structured Decision Room",
    payload: () => {
      throw new Error(
        "Decision Room resolution must be submitted through the structured form.",
      );
    },
    evidenceRefs: [],
  },
  dispatch_execution_wave: {
    label: "Dispatch Safe Wave",
    eyebrow: "Execution Frontier",
    description:
      "Route the current unblocked frontier within worker capacity and ownership constraints.",
    reason: "Dispatched the current safe execution frontier",
    payload: () => ({}),
    evidenceRefs: [],
  },
  retry_execution_assignment: {
    label: "Retry Terminal Assignment",
    eyebrow: "Explicit Recovery",
    description:
      "Return one blocked or failed Assignment to the frontier after its required input is available.",
    reason: "Mission owner authorized an explicit Assignment retry",
    payload: (mission) => {
      const node = mission.execution.nodes.find((candidate) =>
        ["BLOCKED", "ERROR"].includes(candidate.status),
      );
      return {
        retry: {
          assignmentId: node.assignment.id,
          summary: `Retry ${node.assignment.id} after resolving its terminal outcome`,
        },
      };
    },
    evidenceRefs: [],
  },
  start_run: {
    label: "Route Bounded Assignment",
    eyebrow: "Run",
    description: agentRoutingConnected
      ? "Dispatch the declared Assignment through the connected Codex transport."
      : "Dispatch the declared Assignment through the local observable simulator without external mutation.",
    reason: agentRoutingConnected
      ? "Dispatched the planned bounded Assignment"
      : "Dispatched the bounded Assignment to the local observable simulator",
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
    description:
      "Record the completed independent Sol Reviewer outcome with no material findings.",
    reason: "Independent Sol Reviewer found no material issues",
    payload: (mission) => {
      if (!mission.execution) {
        return {
          review: {
            summary: "No material correctness or security findings",
            details: { outcome: "passed", method: "Observed review" },
          },
        };
      }
      const reviewerNode = mission.execution.nodes.find(
        (node) => node.assignment.workKind === "review",
      );
      return {
        review: {
          summary: "Independent reviewer outcome passed",
          reviewerAssignmentId: reviewerNode.assignment.id,
          ...structuredClone(reviewerNode.reviewOutcome),
        },
      };
    },
    evidenceRefs: (mission) =>
      mission.executionReviewEvidenceRefs?.length
        ? mission.executionReviewEvidenceRefs
        : [localEventRef(mission, "review-pass")],
    actor: (mission) =>
      mission.execution ? "agent:sol_reviewer" : "mission-owner",
  },
  reject_review: {
    label: "Request Review Changes",
    eyebrow: "Review Gate",
    description:
      "Record a distinct review failure and return the candidate to correction.",
    reason: "Independent review requested owned corrections",
    payload: (mission) => {
      if (!mission.execution) {
        return {
          review: {
            summary: "Review found a correction that must be resolved",
            findings: ["Regenerate the affected Artifact and Evidence"],
          },
        };
      }
      const reviewerNode = mission.execution.nodes.find(
        (node) =>
          node.assignment.workKind === "review" &&
          node.status === "COMPLETED",
      );
      return {
        review: {
          summary: "Independent reviewer requested owned corrections",
          reviewerAssignmentId: reviewerNode.assignment.id,
          findings: structuredClone(reviewerNode.reviewOutcome.findings),
        },
      };
    },
    evidenceRefs: (mission) => {
      const reviewerNode = mission.execution?.nodes.find(
        (node) =>
          node.assignment.workKind === "review" &&
          node.status === "COMPLETED",
      );
      return reviewerNode?.evidenceRefs?.length
        ? reviewerNode.evidenceRefs
        : [localEventRef(mission, "review-failure")];
    },
    actor: (mission) =>
      mission.execution ? "agent:sol_reviewer" : "mission-owner",
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
            <small>${commandDeck.metrics.agentTelemetry === "Observed" ? "Assignment / Run observations available" : agentRoutingConnected ? "Agent transport connected · awaiting observations" : "Local observable simulator · awaiting observations"}</small>
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
          <small>${model.metrics.agentTelemetry === "Observed" ? "Runtime state replayed from Assignment / Run events" : agentRoutingConnected ? "Transport connected · no Run observations yet" : "Local simulator ready · no Run observations yet"}</small>
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
          <span class="honesty-note ${model.metrics.agentTelemetry === "Observed" ? "is-observed" : ""}"><span></span> ${model.metrics.agentTelemetry === "Observed" ? "Observed Assignment / Run telemetry" : agentRoutingConnected ? "Transport connected · awaiting Run" : "Local observable simulator · awaiting Run"}</span>
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
        <small>${escapeHtml(role.latestEvidence ?? "No observed Evidence")} · ${escapeHtml(role.queuePosition ? `Queue ${role.queuePosition}` : "Not queued")}</small>
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

function renderDecisionRoomActionForm(mission, action, step) {
  if (action === "open_decision_room") {
    const { assignmentId, evidenceRefs } =
      decisionRoomInputForMission(mission);
    return `
      <form class="action-card decision-action-card" id="decision-room-action-form" data-decision-action="open_decision_room">
        <div>
          <p class="eyebrow">${escapeHtml(step.eyebrow)}</p>
          <h2 id="next-action-title">${escapeHtml(step.label)}</h2>
          <p>${escapeHtml(step.description)}</p>
          <p class="decision-form-assignment">Assignment ${escapeHtml(assignmentId)}</p>
        </div>
        <div class="form-grid decision-form-grid">
          <label class="field span-2"><span>Decision question</span><textarea name="question" rows="2" required placeholder="What consequential choice must be made?"></textarea></label>
          <label class="field span-2"><span>Expected decision Artifact</span><input name="expectedOutput" required placeholder="What reusable output must this room produce?" /></label>
          <label class="field"><span>Orchestrator input</span><textarea name="orchestratorInput" rows="3" required placeholder="Coordination constraints and recommendation"></textarea></label>
          <label class="field"><span>Sol Architect input</span><textarea name="architectInput" rows="3" required placeholder="Architecture judgment and boundary risks"></textarea></label>
          <label class="field span-2"><span>Sol Reviewer input</span><textarea name="reviewerInput" rows="3" required placeholder="Independent failure scenarios and verification needs"></textarea></label>
          <label class="field span-2"><span>Input Evidence (one reference per line)</span><textarea name="inputEvidence" rows="3" required>${escapeHtml(evidenceRefs.join("\n"))}</textarea></label>
          <label class="field"><span>Alternative A label</span><input name="alternativeALabel" required placeholder="First viable option" /></label>
          <label class="field"><span>Alternative B label</span><input name="alternativeBLabel" required placeholder="Second viable option" /></label>
          <label class="field"><span>Alternative A trade-offs (one per line)</span><textarea name="alternativeATradeoffs" rows="4" required></textarea></label>
          <label class="field"><span>Alternative B trade-offs (one per line)</span><textarea name="alternativeBTradeoffs" rows="4" required></textarea></label>
          <label class="field"><span>Recommendation</span><select name="recommendation" required><option value="" selected disabled>Select an alternative</option><option value="alternative-a">Alternative A</option><option value="alternative-b">Alternative B</option></select></label>
          <label class="field"><span>Recommendation rationale</span><textarea name="recommendationRationale" rows="3" required></textarea></label>
          <label class="field span-2"><span>Validation plan (one step per line)</span><textarea name="validationPlan" rows="4" required></textarea></label>
        </div>
        <button class="primary-button action-button" type="submit">Open Decision Room <span aria-hidden="true">→</span></button>
      </form>
    `;
  }

  const room = mission.execution.decisionRooms.find(
    (candidate) => candidate.status === "OPEN",
  );
  return `
    <form class="action-card decision-action-card" id="decision-room-action-form" data-decision-action="resolve_decision_room">
      <div>
        <p class="eyebrow">${escapeHtml(step.eyebrow)}</p>
        <h2 id="next-action-title">${escapeHtml(room.question)}</h2>
        <p>Expected output: ${escapeHtml(room.expectedOutput)}</p>
      </div>
      <fieldset class="decision-choice-fieldset">
        <legend>Select the human decision</legend>
        ${room.alternatives
          .map(
            (alternative) => `<label><input type="radio" name="selectedAlternativeId" value="${escapeHtml(alternative.id)}" required /> <span><strong>${escapeHtml(alternative.label)}</strong><small>${escapeHtml(alternative.tradeoffs.join(" · "))}</small></span></label>`,
          )
          .join("")}
      </fieldset>
      <label class="field"><span>Decision rationale</span><textarea name="decisionRationale" rows="3" required></textarea></label>
      <label class="field"><span>Decision Artifact summary</span><textarea name="artifactSummary" rows="3" required placeholder="Summarize the reusable conclusion and its validation commitment"></textarea></label>
      <button class="primary-button action-button" type="submit">Resolve and record Artifact <span aria-hidden="true">→</span></button>
    </form>
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

      ${renderTaskExecutionContent(flow.execution)}

      <section class="agent-lanes-panel" aria-labelledby="agent-lanes-title">
        <div class="section-heading compact">
          <div>
            <p class="eyebrow">CONFIGURED HAND-OFFS</p>
            <h2 id="agent-lanes-title">Agent lanes</h2>
          </div>
          <span class="honesty-note ${mission.agent || flow.execution?.observed ? "is-observed" : ""}"><span></span> ${mission.agent || flow.execution?.observed ? "Replayed Assignment / Run observations" : "No Assignment / Run observations"}</span>
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
                ${
                  ["open_decision_room", "resolve_decision_room"].includes(
                    nextAction,
                  )
                    ? renderDecisionRoomActionForm(mission, nextAction, step)
                    : `
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
                }
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
      <span class="lane-connection">${escapeHtml(role.runtimeStatus === "DISCONNECTED" ? role.connection : `${role.runtimeStatus}${role.elapsedTime ? ` · ${role.elapsedTime}` : ""}${role.queuePosition ? ` · Queue ${role.queuePosition}` : ""}`)}</span>
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
  document
    .querySelector("#decision-room-action-form")
    ?.addEventListener("submit", handleDecisionRoomAction);

  document.querySelectorAll("[data-run-action]").forEach((button) => {
    button.addEventListener("click", (event) => {
      const action = event.currentTarget.dataset.runAction;
      advanceMission(action);
    });
  });
}

async function handleDecisionRoomAction(event) {
  event.preventDefault();
  const mission = orchestrator.getMission(activeMissionId);
  const action = event.currentTarget.dataset.decisionAction;
  const form = new FormData(event.currentTarget);
  const value = (name) => String(form.get(name) ?? "").trim();
  const lines = (name) =>
    value(name)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  if (action === "open_decision_room") {
    const { assignmentId } = decisionRoomInputForMission(mission);
    const evidenceRefs = lines("inputEvidence");
    const participantRoles = [
      "orchestrator",
      "sol_architect",
      "sol_reviewer",
    ];
    await advanceMission(action, {
      evidenceRefs,
      payload: {
        decisionRoom: {
          id: `decision-room:${assignmentId}:event-${mission.events.length + 1}`,
          assignmentId,
          assignmentAttempt:
            mission.execution.nodes.find(
              (node) => node.assignment.id === assignmentId,
            ).attempt + 1,
          question: value("question"),
          participantRoles,
          participantInputs: [
            {
              roleId: "orchestrator",
              contribution: value("orchestratorInput"),
              evidenceRefs,
            },
            {
              roleId: "sol_architect",
              contribution: value("architectInput"),
              evidenceRefs,
            },
            {
              roleId: "sol_reviewer",
              contribution: value("reviewerInput"),
              evidenceRefs,
            },
          ],
          expectedOutput: value("expectedOutput"),
          alternatives: [
            {
              id: "alternative-a",
              label: value("alternativeALabel"),
              tradeoffs: lines("alternativeATradeoffs"),
            },
            {
              id: "alternative-b",
              label: value("alternativeBLabel"),
              tradeoffs: lines("alternativeBTradeoffs"),
            },
          ],
          recommendation: {
            alternativeId: value("recommendation"),
            rationale: value("recommendationRationale"),
          },
          validationPlan: lines("validationPlan"),
        },
      },
    });
    return;
  }

  const room = mission.execution.decisionRooms.find(
    (candidate) => candidate.status === "OPEN",
  );
  await advanceMission(action, {
    payload: {
      decision: {
        roomId: room.id,
        assignmentAttempt: room.assignmentAttempt,
        selectedAlternativeId: value("selectedAlternativeId"),
        rationale: value("decisionRationale"),
        artifact: {
          id: `decision-artifact:${room.id}:event-${mission.events.length + 1}`,
          uri: `local://missions/${mission.id}/decisions/${room.id}/event-${mission.events.length + 1}`,
          summary: value("artifactSummary"),
        },
      },
    },
    evidenceRefs: [],
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

async function advanceMission(action, overrides = {}) {
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
      overrides.evidenceRefs ??
      (typeof step.evidenceRefs === "function"
        ? step.evidenceRefs(mission)
        : step.evidenceRefs);
    const actor =
      typeof step.actor === "function"
        ? step.actor(mission)
        : (step.actor ?? "mission-owner");
    const updated =
      action === "dispatch_execution_wave"
        ? await orchestrator.dispatchExecutionWave(mission.id, {
            actor,
            reason: step.reason,
          })
        : action === "start_run" && mission.plan?.assignment
        ? await orchestrator.dispatchAssignment(mission.id, {
            assignment: mission.plan.assignment,
            actor,
            reason: step.reason,
          })
        : action === "start_correction" &&
            mission.assignment
          ? await orchestrator.dispatchCorrection(mission.id, {
              actor,
              reason: step.reason,
            })
        : await orchestrator.execute(mission.id, {
            type: MISSION_COMMAND_BY_ACTION[action],
            payload: overrides.payload ?? step.payload(mission),
            actor,
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

eventStore.subscribe(() => render());
render();
