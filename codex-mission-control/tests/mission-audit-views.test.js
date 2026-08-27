import test from "node:test";
import assert from "node:assert/strict";

import { renderMissionAuditView } from "../src/mission-audit-views.js";

const mission = {
  id: "mission-production-ui",
  brief: {
    goal: "Operate Mission Control accessibly",
    scope: "Production operations UI",
    risk: "high",
    releaseRequired: true,
    releaseAuthority: "mission-owner",
  },
  status: "APPROVAL_REQUIRED",
  events: [
    {
      id: "event-1",
      missionId: "mission-production-ui",
      sequence: 1,
      type: "MISSION_CREATED",
      actor: "mission-owner",
      occurredAt: "2026-08-27T08:00:00.000Z",
      reason: "Create production UI Mission",
      evidenceRefs: [],
      data: {},
    },
    {
      id: "event-2",
      missionId: "mission-production-ui",
      sequence: 2,
      type: "REVIEW_PASSED",
      actor: "agent:sol_reviewer",
      occurredAt: "2026-08-27T09:00:00.000Z",
      reason: "Review found no blocker",
      evidenceRefs: ["evidence://review-pass"],
      data: {},
    },
    {
      id: "event-3",
      missionId: "mission-production-ui",
      sequence: 3,
      type: "VALIDATION_PASSED",
      actor: "mission-owner",
      occurredAt: "2026-08-27T10:00:00.000Z",
      reason: "Accessibility checks passed",
      evidenceRefs: ["evidence://a11y"],
      data: { metrics: { tokenUse: 900 } },
    },
  ],
  execution: {
    capacity: 4,
    reservedSlots: 1,
    frontier: [],
    waves: [],
    nodes: [
      {
        assignment: { id: "build-dashboard", goal: "Build the dashboard" },
        status: "COMPLETED",
        agent: { roleId: "terra_builder", roleName: "Terra Builder" },
        run: { id: "run-dashboard", status: "COMPLETED" },
        artifacts: [
          {
            uri: "artifact://dashboard",
            summary: "Production dashboard patch",
            diff: "+ accessible filters",
          },
        ],
        evidenceRefs: ["evidence://dashboard-tests"],
      },
    ],
    decisionRooms: [
      {
        id: "decision-room:navigation",
        question: "Which navigation model keeps audit destinations coherent?",
        status: "RESOLVED",
        participantRoles: ["orchestrator", "sol_architect"],
        alternatives: [
          { id: "flat", label: "Flat navigation", tradeoffs: ["Direct"] },
          { id: "nested", label: "Nested navigation", tradeoffs: ["Compact"] },
        ],
        decision: {
          selectedAlternativeId: "flat",
          rationale: "Critical destinations remain directly reachable",
          actor: "mission-owner",
        },
        inputEvidenceRefs: ["evidence://navigation-study"],
      },
    ],
  },
};

test("Runs & Artifacts renders replayed assignments, runtime, Artifact detail, and Evidence", () => {
  const markup = renderMissionAuditView(mission, "runs");

  assert.match(markup, /<h1[^>]*>Runs &amp; Artifacts<\/h1>/);
  assert.match(markup, /build-dashboard/);
  assert.match(markup, /run-dashboard/);
  assert.match(markup, /artifact:\/\/dashboard/);
  assert.match(markup, /\+ accessible filters/);
  assert.match(markup, /evidence:\/\/dashboard-tests/);
});

test("Decision Rooms renders the auditable question, alternatives, decision, and input Evidence", () => {
  const markup = renderMissionAuditView(mission, "decisions");

  assert.match(markup, /Which navigation model keeps audit destinations coherent\?/);
  assert.match(markup, /Flat navigation/);
  assert.match(markup, /Critical destinations remain directly reachable/);
  assert.match(markup, /evidence:\/\/navigation-study/);
});

test("Quality Gates renders separate gate outcomes with actors and Evidence", () => {
  const markup = renderMissionAuditView(mission, "gates");

  assert.match(markup, /Review Passed/);
  assert.match(markup, /agent:sol_reviewer/);
  assert.match(markup, /evidence:\/\/review-pass/);
  assert.match(markup, /Validation Passed/);
  assert.match(markup, /evidence:\/\/a11y/);
});

test("Metrics remains traceable and Settings states the local-only authority boundary", () => {
  const metrics = renderMissionAuditView(mission, "metrics", {
    now: "2026-08-27T11:00:00.000Z",
  });
  assert.match(metrics, /Token use/);
  assert.match(metrics, />900</);
  assert.match(metrics, /event #3/);
  assert.match(metrics, /evidence:\/\/a11y/);

  const settings = renderMissionAuditView(null, "settings", {
    agentRoutingConnected: false,
  });
  assert.match(settings, /Local-only settings/);
  assert.match(settings, /codex-mission-control-events-v1/);
  assert.match(settings, /Agent transport not connected/);
  assert.match(settings, /never commits, pushes, releases, or deploys/i);
});

test("unsupported audit destinations fail closed", () => {
  assert.throws(
    () => renderMissionAuditView(mission, "prototype"),
    /Unsupported Mission audit view/,
  );
});
