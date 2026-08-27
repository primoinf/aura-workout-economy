import test from "node:test";
import assert from "node:assert/strict";

import { buildMissionNavigation, renderMissionNavigation } from "../src/mission-navigation.js";

test("primary navigation exposes every production operations and audit destination", () => {
  const items = buildMissionNavigation({
    activeView: "runs",
    mission: { id: "mission-7", status: "COMPLETED" },
    approvalAvailable: true,
    playbookAvailable: true,
  });

  assert.deepEqual(
    items.map((item) => item.label),
    [
      "Overview",
      "Mission Detail",
      "Runs & Artifacts",
      "Decision Rooms",
      "Quality Gates",
      "Approval Room",
      "Playbooks",
      "Metrics",
      "Settings",
    ],
  );
  assert.equal(items.find((item) => item.view === "runs").current, true);
  assert.equal(items.every((item) => item.disabled === false), true);

  const markup = renderMissionNavigation(items);
  assert.match(markup, /<nav[^>]+aria-label="Primary navigation"/);
  assert.match(markup, /data-route="runs"[^>]+aria-current="page"/);
  assert.doesNotMatch(markup, /prototype|variant|scenario/i);
});

test("Mission-specific destinations stay visibly unavailable until a Mission or decision exists", () => {
  const items = buildMissionNavigation({
    activeView: "overview",
    mission: null,
    approvalAvailable: false,
    playbookAvailable: false,
  });

  assert.equal(items.find((item) => item.view === "overview").disabled, false);
  assert.equal(items.find((item) => item.view === "metrics").disabled, false);
  assert.equal(items.find((item) => item.view === "settings").disabled, false);
  for (const view of ["detail", "runs", "decisions", "gates", "approval", "playbook"]) {
    assert.equal(items.find((item) => item.view === view).disabled, true);
  }

  const markup = renderMissionNavigation(items);
  assert.match(markup, /data-route="approval"[^>]+disabled/);
  assert.match(markup, /No decision pending/);
});
