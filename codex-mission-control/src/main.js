import {
  MISSION_COMMAND_BY_ACTION,
  createBrowserWriteCoordinator,
  createLocalStorageEventStore,
  createMissionOrchestrator,
  deriveTransportObservedReleaseValidation,
  getOpenExecutionTransportReservations,
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
import {
  buildPlaybookActionCommand,
  derivePlaybookRoomModel,
  renderPlaybookRoomContent,
} from "./playbook-room-view.js";
import {
  DASHBOARD_FILTER_DEFAULTS,
  deriveOperationsDashboard,
  parseDashboardFilters,
  serializeDashboardFilters,
} from "./operations-dashboard.js";
import { renderOperationsDashboardContent } from "./operations-dashboard-view.js";
import {
  buildMissionNavigation,
  renderMissionNavigation,
} from "./mission-navigation.js";
import { renderMissionAuditView } from "./mission-audit-views.js";
import { createContextPackCapture } from "./context-pack-capture.js";

const liveAgentTransport =
  typeof globalThis.codexAgentTransport?.run === "function"
    ? globalThis.codexAgentTransport
    : null;
const agentRouter = liveAgentTransport
  ? createAgentRoutingAdapter({ transport: liveAgentTransport })
  : null;
const agentRoutingConnected = liveAgentTransport !== null;
const AGENT_DISPATCH_ACTIONS = new Set([
  "dispatch_execution_wave",
  "record_playbook_independent_review",
  "start_correction",
  "start_run",
]);
const AGENT_TRANSPORT_UNAVAILABLE_MESSAGE =
  "Agent transport is disconnected. Agent-backed dispatch is unavailable until a Codex transport is connected.";
const contextPackCapture = createContextPackCapture(
  globalThis.codexContextCapture ?? null,
);
const CONTEXT_CAPTURE_UNAVAILABLE_MESSAGE =
  "Context capture is unavailable. Connect a workspace Context capture adapter before recording a Context Pack.";
const eventStore = createLocalStorageEventStore();
const orchestrator = createMissionOrchestrator({
  eventStore,
  writeCoordinator: createBrowserWriteCoordinator(),
  agentRouter,
});

const app = document.querySelector("#app");

function isAgentDispatchUnavailable(action) {
  return !agentRoutingConnected && AGENT_DISPATCH_ACTIONS.has(action);
}

function assertAgentDispatchAvailable(action) {
  if (isAgentDispatchUnavailable(action)) {
    throw new Error(AGENT_TRANSPORT_UNAVAILABLE_MESSAGE);
  }
}

function unavailableActionMessage(action) {
  if (isAgentDispatchUnavailable(action)) {
    return AGENT_TRANSPORT_UNAVAILABLE_MESSAGE;
  }
  if (
    ["capture_context", "revise_context"].includes(action) &&
    !contextPackCapture.connected
  ) {
    return CONTEXT_CAPTURE_UNAVAILABLE_MESSAGE;
  }
  return null;
}

function assertActionAvailable(action) {
  const message = unavailableActionMessage(action);
  if (message) {
    throw new Error(message);
  }
}

function actionButtonAttributes(action, description) {
  const message = unavailableActionMessage(action);
  return message
    ? `disabled aria-disabled="true" title="${escapeHtml(message)}"`
    : `title="${escapeHtml(description)}"`;
}

function agentTransportStatusCopy(agentTelemetry) {
  if (agentRoutingConnected) {
    return agentTelemetry === "Observed"
      ? "Agent transport connected · Assignment / Run observations available"
      : "Agent transport connected · awaiting observations";
  }
  return agentTelemetry === "Observed"
    ? "Agent transport disconnected · replayed Assignment / Run observations"
    : "Agent transport disconnected · dispatch unavailable";
}

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
    description: contextPackCapture.connected
      ? "Capture current workspace rules, repository state, recent context, task status, and decisions with source-backed facts and assumptions."
      : CONTEXT_CAPTURE_UNAVAILABLE_MESSAGE,
    reason: "Captured the source-backed workspace Context Pack",
    payload: () => {
      throw new Error("Context capture must use the workspace adapter.");
    },
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
      const validationAssignments = mission.brief.releaseRequired
        ? mission.brief.releasePlan.requiredValidationGates.map(
            (gateType, index) =>
              assignment(
                `validate-${index + 1}`,
                `Run the declared ${gateType} release validation gate and return its structured transport-observed outcome`,
                {
                  dependsOn: [buildId],
                  validationGateType: gateType,
                  expectedEvidence: [
                    `One Artifact containing validationOutcome with type ${gateType}, passing status/outcome, and an Evidence ref emitted by this transport Run`,
                  ],
                },
              ),
          )
        : [];
      const reviewDependencies = validationAssignments.length
        ? validationAssignments.map((candidate) => candidate.id)
        : [buildId];
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
              ...validationAssignments,
              assignment(
                "review",
                "Independently review the completed candidate",
                {
                  dependsOn: reviewDependencies,
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
      : "Agent transport is disconnected. This Assignment cannot be dispatched until a Codex transport is available.",
    reason: agentRoutingConnected
      ? "Dispatched the planned bounded Assignment"
      : "Agent transport is unavailable for this Assignment",
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
          outcome: reviewerNode.reviewOutcome.outcome,
          candidateArtifactRefs: structuredClone(
            reviewerNode.reviewOutcome.candidateArtifactRefs,
          ),
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
  recover_execution_transport: {
    label: "Recover Stalled Transport",
    eyebrow: "Explicit Recovery",
    description:
      "After confirming the old transport cannot continue, release its durable worker reservation for this Mission.",
    reason: "Mission owner recovered a stalled execution transport reservation",
    payload: (mission) => {
      const reservation = getOpenExecutionTransportReservations(mission)[0];
      if (!reservation) {
        throw new Error("No open execution transport reservation remains.");
      }
      return {
        recovery: {
          assignmentId: reservation.assignmentId,
          waveId: reservation.waveId,
          attempt: reservation.attempt,
          summary:
            "Confirmed the prior transport cannot continue and released its durable reservation",
        },
      };
    },
    evidenceRefs: [],
  },
  pass_validation: {
    label: "Pass Validation",
    eyebrow: "Validation Gate",
    description:
      "Record passing acceptance Evidence; release Missions use only completed transport-observed gate outcomes.",
    reason: "Acceptance validation passed",
    payload: (mission) => {
      if (mission.brief.releaseRequired) {
        const observed = deriveTransportObservedReleaseValidation(mission);
        return {
          validation: {
            summary: "Every declared release validation gate passed through transport",
            gates: observed.gates,
          },
        };
      }
      return {
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
      };
    },
    evidenceRefs: (mission) =>
      mission.brief.releaseRequired
        ? deriveTransportObservedReleaseValidation(mission).evidenceRefs
        : [localEventRef(mission, "validation-pass")],
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
    payload: () => {
      throw new Error("Context revision must use the workspace adapter.");
    },
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
let dashboardFilters = parseDashboardFilters(initialUrl.search);
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

function isPlaybookRouteAvailable(mission) {
  return mission?.status === "COMPLETED";
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
    if (view === "overview") {
      url.searchParams.delete("view");
    } else {
      url.searchParams.set("view", view);
    }
  }
  window.history.pushState({}, "", url);
  render();
  focusCurrentView();
}

function focusCurrentView() {
  document
    .querySelector("#page-title, #approval-title, #playbook-title")
    ?.focus();
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
  const playbookAvailable = isPlaybookRouteAvailable(selectedMission);
  const navigation = buildMissionNavigation({
    activeView: view,
    mission: selectedMission,
    approvalAvailable,
    playbookAvailable,
  });

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

        ${renderMissionNavigation(navigation)}

        <div class="sidebar-team" aria-label="Configured Codex team">
          <span class="sidebar-team-dot ${commandDeck.metrics.agentTelemetry === "Observed" ? "is-observed" : ""}" aria-hidden="true"></span>
          <div>
            <strong>${commandDeck.metrics.configuredAgents} configured roles</strong>
            <small>${agentTransportStatusCopy(commandDeck.metrics.agentTelemetry)}</small>
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

function renderOverview(view = "overview") {
  const missions = getMissions();
  const currentHistoryError = historyReadError;

  if (currentHistoryError) {
    renderShell(renderHistoryError(currentHistoryError), "overview");
    return;
  }
  const model = deriveOperationsDashboard(missions, dashboardFilters);
  renderShell(renderOperationsDashboardContent(model), view);
}

function renderAuditView(mission, view) {
  renderShell(
    renderMissionAuditView(mission, view, { agentRoutingConnected }),
    view,
  );
}

function updateDashboardFilters(filters) {
  dashboardFilters = Object.freeze({
    ...DASHBOARD_FILTER_DEFAULTS,
    ...filters,
  });
  const url = new URL(window.location.href);
  url.search = serializeDashboardFilters(dashboardFilters, url.search);
  window.history.pushState({}, "", url);
  render();
  focusCurrentView();
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
                                <button class="secondary-button ${action === "cancel_mission" ? "danger-button" : ""}" type="button" data-run-action="${escapeHtml(action)}" ${actionButtonAttributes(action, secondaryStep.description)}>
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
                        <button class="primary-button action-button" type="button" data-run-action="${escapeHtml(nextAction)}" ${actionButtonAttributes(nextAction, step.description)}>
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
                                <button class="secondary-button ${action === "cancel_mission" ? "danger-button" : ""}" type="button" data-run-action="${escapeHtml(action)}" ${actionButtonAttributes(action, secondaryStep.description)}>
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
                ${renderBriefList("Required validation gates", mission.brief.releasePlan.requiredValidationGates)}
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

function renderPlaybookRoom(mission) {
  const model = derivePlaybookRoomModel(mission);
  renderShell(renderPlaybookRoomContent(model), "playbook");
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
          <label class="field span-2">
            <span>Required validation gates (one type per line)</span>
            <textarea name="requiredValidationGates" rows="3">unit-tests
integration-tests</textarea>
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
  document.querySelectorAll("[data-route='playbook']").forEach((button) => {
    button.addEventListener("click", () => {
      const mission = getMissions().find(
        (item) => item.id === activeMissionId,
      );
      if (isPlaybookRouteAvailable(mission)) {
        setActiveMission(mission.id, "playbook");
      }
    });
  });
  for (const view of ["runs", "decisions", "gates"]) {
    document.querySelectorAll(`[data-route='${view}']`).forEach((button) => {
      button.addEventListener("click", () => {
        const mission = getMissions().find(
          (item) => item.id === activeMissionId,
        );
        if (mission) setActiveMission(mission.id, view);
      });
    });
  }
  document.querySelectorAll("[data-route='metrics']").forEach((button) => {
    button.addEventListener("click", () =>
      setActiveMission(activeMissionId, "metrics"),
    );
  });
  document.querySelectorAll("[data-route='settings']").forEach((button) => {
    button.addEventListener("click", () => setActiveMission(null, "settings"));
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
    .querySelector("#dashboard-filter-form")
    ?.addEventListener("submit", (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      updateDashboardFilters({
        mission: String(form.get("missionFilter") ?? ""),
        agent: String(form.get("agent") ?? "all"),
        state: String(form.get("state") ?? "all"),
        risk: String(form.get("risk") ?? "all"),
        time: String(form.get("time") ?? "all"),
      });
    });
  document.querySelectorAll("[data-clear-dashboard-filters]").forEach((button) => {
    button.addEventListener("click", () =>
      updateDashboardFilters(DASHBOARD_FILTER_DEFAULTS),
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
      return advanceMission(action);
    });
  });
  document.querySelectorAll("[data-playbook-action]").forEach((button) => {
    if (isAgentDispatchUnavailable(button.dataset.playbookAction)) {
      button.disabled = true;
      button.title = AGENT_TRANSPORT_UNAVAILABLE_MESSAGE;
      button.setAttribute("aria-disabled", "true");
    }
    button.addEventListener("click", (event) => {
      return handlePlaybookAction(event.currentTarget.dataset.playbookAction);
    });
  });
}

async function handlePlaybookAction(action) {
  const mission = orchestrator.getMission(activeMissionId);
  try {
    let updated;
    if (action === "record_playbook_independent_review") {
      assertAgentDispatchAvailable(action);
      updated = await orchestrator.dispatchPlaybookIndependentReview(
        mission.id,
        {
          actor: mission.brief.releaseAuthority,
          reason:
            "Mission owner dispatched the bounded Playbook Candidate for independent review",
        },
      );
    } else {
      let input = {};
      if (action === "evaluate_playbook_candidate") {
        input = {
          actor: mission.brief.releaseAuthority,
        };
      } else if (
        [
          "approve_playbook_promotion",
          "reject_playbook_candidate",
          "rollback_playbook_version",
        ].includes(action)
      ) {
        const rationale = window.prompt(
          "Record the explicit human rationale for this immutable Playbook decision.",
        );
        if (rationale === null) return;
        input = {
          actor: mission.brief.releaseAuthority,
          rationale: rationale.trim(),
          evidenceRefs:
            action === "approve_playbook_promotion"
              ? mission.playbook.independentReview?.evidenceRefs ?? []
              : [],
        };
      }
      if (!input.actor) {
        input.actor = mission.brief.releaseAuthority;
      }
      updated = await orchestrator.execute(
        mission.id,
        buildPlaybookActionCommand(action, input),
      );
    }
    notice = {
      kind: "success",
      message: `${humanize(updated.playbook.status)} recorded without deployment or protected-policy mutation.`,
    };
  } catch (error) {
    notice = { kind: "error", message: error.message };
  }
  render();
  focusCurrentView();
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
                requiredValidationGates: lines(
                  "requiredValidationGates",
                ),
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
  if (
    action === "recover_execution_transport" &&
    !window.confirm(
      "Recover this transport reservation only after confirming the prior transport cannot continue. Continue?",
    )
  ) {
    return;
  }

  try {
    assertActionAvailable(action);
    let payload = overrides.payload;
    if (["capture_context", "revise_context"].includes(action)) {
      const contextPackVersion =
        action === "revise_context"
          ? mission.contextPackVersion + 1
          : mission.contextPackVersion;
      const capture = await contextPackCapture.capture({
        missionId: mission.id,
        brief: mission.brief,
        contextPackVersion,
        previousContext:
          action === "revise_context" ? mission.context : null,
      });
      if (!capture.ready) {
        throw new Error(
          `Context capture is unavailable: ${capture.unavailableSources.join(", ")}.`,
        );
      }
      payload = { context: capture.context };
    }
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
            payload: payload ?? step.payload(mission),
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
    } else if (
      activeView === "playbook" &&
      isPlaybookRouteAvailable(mission)
    ) {
      renderPlaybookRoom(mission);
    } else if (["runs", "decisions", "gates", "metrics"].includes(activeView)) {
      renderAuditView(mission, activeView);
    } else {
      activeView = "detail";
      renderMissionDetail(mission);
    }
  } else if (activeView === "settings") {
    renderAuditView(null, "settings");
  } else if (activeView === "metrics") {
    renderOverview("metrics");
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
  dashboardFilters = parseDashboardFilters(url.search);
  render();
  focusCurrentView();
});

eventStore.subscribe(() => render());
render();
