import test from "node:test";
import assert from "node:assert/strict";

import { renderOperationsDashboardContent } from "../src/operations-dashboard-view.js";

const model = {
  filters: {
    mission: "audit",
    agent: "terra_builder",
    state: "RUNNING",
    risk: "high",
    time: "7d",
  },
  resultCount: 1,
  missions: [
    {
      id: "mission-audit",
      goal: "Audit the command deck",
      scope: "Operations UI",
      risk: "high",
      status: "RUNNING",
      latestEvent: {
        sequence: 7,
        occurredAt: "2026-08-27T12:00:00.000Z",
      },
      observedAgents: ["terra_builder"],
      source: {
        missionId: "mission-audit",
        eventSequence: 7,
        eventType: "EXECUTION_RUN_STARTED",
        evidenceRefs: ["evidence://run"],
        label: "Latest observable Mission state",
      },
    },
  ],
  metrics: {
    currentMissions: {
      label: "Current Missions",
      value: 1,
      status: "observed",
      explanation: "Count of non-terminal Missions.",
      sources: [
        {
          missionId: "mission-audit",
          eventSequence: 7,
          eventType: "EXECUTION_RUN_STARTED",
          evidenceRefs: ["evidence://run"],
          label: "Current Mission state",
        },
      ],
    },
    tokenUse: {
      label: "Token use",
      value: null,
      status: "unavailable",
      explanation: "Token use was not recorded by runtime events.",
      sources: [],
    },
  },
};

test("operations dashboard renders labelled URL-backed filters and traceable aggregates", () => {
  const markup = renderOperationsDashboardContent(model);

  assert.match(markup, /<form[^>]+id="dashboard-filter-form"/);
  for (const name of ["missionFilter", "agent", "state", "risk", "time"]) {
    assert.match(markup, new RegExp(`name="${name}"`));
  }
  assert.match(markup, /value="terra_builder" selected/);
  assert.match(markup, /value="RUNNING" selected/);
  assert.match(markup, /value="BRIEF_ACCEPTED"/);
  assert.match(markup, /value="IN_REVIEW"/);
  assert.match(markup, /1 matching Mission/);
  assert.match(markup, /Audit the command deck/);
  assert.match(markup, /Open Mission: Audit the command deck/);

  assert.match(markup, /<details[^>]+class="metric-provenance"/);
  assert.match(markup, /mission-audit · event #7 · EXECUTION_RUN_STARTED/);
  assert.match(markup, /evidence:\/\/run/);
  assert.match(markup, /Telemetry unavailable/);
  assert.match(markup, /Token use was not recorded by runtime events/);
});

test("operations dashboard keeps an accessible empty result with a filter reset control", () => {
  const markup = renderOperationsDashboardContent({
    ...model,
    resultCount: 0,
    missions: [],
  });

  assert.match(markup, /No Missions match these filters/);
  assert.match(markup, /data-clear-dashboard-filters/);
  assert.match(markup, /aria-live="polite"/);
});
