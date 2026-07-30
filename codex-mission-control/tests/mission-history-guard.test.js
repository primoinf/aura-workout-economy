import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryEventStore,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";
import {
  createMissionWhenHistoryReadable,
  readMissionHistory,
} from "../src/mission-history-guard.js";

const validBrief = {
  goal: "Do not hide a new Mission behind corrupt history",
  scope: "Guard Mission creation at the UI command boundary",
  acceptanceCriteria: ["No new Mission is appended while replay fails"],
  constraints: ["Preserve the corrupt record for recovery"],
  risk: "high",
  releaseRequired: false,
  mutationAuthority: "Local storage only",
  releaseAuthority: "Mission owner",
};

test("corrupt existing history disables and guards new Mission creation", () => {
  const eventStore = createMemoryEventStore({
    "mission-corrupt": [
      {
        id: "",
        missionId: "mission-corrupt",
        sequence: 1,
        type: "MISSION_CREATED",
      },
    ],
  });
  const orchestrator = createMissionOrchestrator({
    eventStore,
    clock: () => "2026-07-28T13:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-must-not-exist" : "event-must-not-exist",
  });

  const history = readMissionHistory(orchestrator);

  assert.equal(history.canCreateMission, false);
  assert.match(history.error.message, /event ID is missing or duplicated/);
  assert.throws(
    () =>
      createMissionWhenHistoryReadable(orchestrator, {
        brief: validBrief,
        actor: "mission-owner",
        reason: "Attempt creation while replay is broken",
      }),
    /Mission creation is disabled while local event history cannot be replayed/,
  );
  assert.deepEqual(eventStore.listMissionIds(), ["mission-corrupt"]);
});
