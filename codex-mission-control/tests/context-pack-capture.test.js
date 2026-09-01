import assert from "node:assert/strict";
import test from "node:test";

async function loadCaptureModule() {
  try {
    return await import("../src/context-pack-capture.js");
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") {
      throw error;
    }
    return {};
  }
}

test("missing Context capture adapter reports every required source unavailable", async () => {
  const module = await loadCaptureModule();
  const createContextPackCapture =
    module.createContextPackCapture ??
    (() => ({
      connected: false,
      capture: async () => null,
    }));

  const capture = createContextPackCapture(null);
  const result = await capture.capture({ missionId: "mission-050" });

  assert.deepEqual(result, {
    connected: false,
    ready: false,
    context: null,
    unavailableSources: [
      "workspace-rules",
      "repository-state",
      "recent-context",
      "task-status",
      "decisions",
    ],
  });
});

test("Context capture stays unavailable when any required source is missing", async () => {
  const { createContextPackCapture } = await loadCaptureModule();
  const capture = createContextPackCapture({
    async capture() {
      return {
        summary: "Captured current Mission context",
        capturedAt: "2026-08-28T09:30:00.000Z",
        sources: [
          {
            kind: "workspace-rules",
            ref: "workspace://AGENTS.md",
            status: "available",
          },
          {
            kind: "repository-state",
            ref: "git://status",
            status: "available",
          },
          {
            kind: "recent-context",
            ref: "workspace://hotcache.md",
            status: "available",
          },
          {
            kind: "task-status",
            ref: "workspace://task-board.md#TASK-050",
            status: "available",
          },
          {
            kind: "decisions",
            ref: "workspace://decisions",
            status: "unavailable",
          },
        ],
        facts: [
          {
            statement: "TASK-050 is in progress.",
            sourceRefs: ["workspace://task-board.md#TASK-050"],
          },
        ],
        assumptions: [],
      };
    },
  });

  const result = await capture.capture({ missionId: "mission-050" });

  assert.deepEqual(result, {
    connected: true,
    ready: false,
    context: null,
    unavailableSources: ["decisions"],
  });
});

test("Context capture returns a frozen source-backed facts and assumptions snapshot", async () => {
  const { createContextPackCapture } = await loadCaptureModule();
  const captured = {
    summary: "Captured current Mission context",
    capturedAt: "2026-08-28T09:30:00.000Z",
    sources: [
      {
        kind: "workspace-rules",
        ref: "workspace://AGENTS.md",
        status: "available",
      },
      {
        kind: "repository-state",
        ref: "git://status@784ac616",
        status: "available",
      },
      {
        kind: "recent-context",
        ref: "workspace://hotcache.md",
        status: "available",
      },
      {
        kind: "task-status",
        ref: "workspace://task-board.md#TASK-050",
        status: "available",
      },
      {
        kind: "decisions",
        ref: "workspace://decisions/TASK-050",
        status: "available",
      },
    ],
    facts: [
      {
        statement: "TASK-050 is in progress.",
        sourceRefs: ["workspace://task-board.md#TASK-050"],
      },
    ],
    assumptions: [
      {
        statement: "The transport will be connected before dispatch.",
        sourceRefs: ["workspace://decisions/TASK-050"],
      },
    ],
  };
  const capture = createContextPackCapture({
    capture: async () => captured,
  });

  const result = await capture.capture({ missionId: "mission-050" });

  assert.equal(result.connected, true);
  assert.equal(result.ready, true);
  assert.deepEqual(result.unavailableSources, []);
  assert.deepEqual(result.context, captured);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.context.sources));
  captured.facts[0].statement = "Caller rewrote the fact.";
  assert.equal(result.context.facts[0].statement, "TASK-050 is in progress.");
});
