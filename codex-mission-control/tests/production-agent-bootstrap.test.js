import assert from "node:assert/strict";
import test from "node:test";

import {
  createMemoryEventStore,
  createMissionOrchestrator,
} from "../src/mission-orchestrator.js";
import { createAgentRoutingAdapter } from "../src/agent-routing-adapter.js";

function replaceGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value,
  });
  return () => {
    if (previous) {
      Object.defineProperty(globalThis, name, previous);
    } else {
      delete globalThis[name];
    }
  };
}

function sourceBackedContext(summary) {
  return {
    summary,
    capturedAt: "2026-08-28T08:59:00.000Z",
    sources: [
      { kind: "workspace-rules", ref: "workspace://AGENTS.md", status: "available" },
      { kind: "repository-state", ref: "git://status@784ac616", status: "available" },
      { kind: "recent-context", ref: "workspace://hotcache.md", status: "available" },
      { kind: "task-status", ref: "workspace://task-board.md#TASK-050", status: "available" },
      { kind: "decisions", ref: "workspace://decisions/TASK-050", status: "available" },
    ],
    facts: [
      {
        statement: "TASK-050 is the active Mission Control remediation.",
        sourceRefs: ["workspace://task-board.md#TASK-050"],
      },
    ],
    assumptions: [],
  };
}

function createPlannedMissionHistory() {
  let eventNumber = 0;
  const source = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    writeCoordinator: {
      runExclusive(operation) {
        return operation();
      },
    },
    clock: () => "2026-08-28T09:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-disconnected" : `event-${++eventNumber}`,
  });
  const created = source.createMission({
    brief: {
      goal: "Prove unavailable transport dispatches no work",
      scope: "Only a bounded local Mission lifecycle",
      acceptanceCriteria: ["No Run event is appended without transport"],
      constraints: ["Do not dispatch a synthetic agent"],
      risk: "low",
      mutationAuthority: "workspace-write:codex-mission-control",
      releaseRequired: false,
      releaseAuthority: "mission-owner",
    },
    actor: "mission-owner",
    reason: "Create an isolated planned Mission",
  });
  source.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("A bounded Context Pack"),
    },
    actor: "mission-owner",
    reason: "Capture the Context Pack",
  });
  const planned = source.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { steps: ["route one bounded Assignment"] } },
    actor: "mission-owner",
    reason: "Accept the bounded routing plan",
  });

  return { id: planned.id, events: planned.events };
}

function createBriefMissionHistory() {
  let eventNumber = 0;
  const source = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    clock: () => "2026-08-28T09:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-context-unavailable" : `event-${++eventNumber}`,
  });
  const created = source.createMission({
    brief: {
      goal: "Capture source-backed Mission context",
      scope: "Only the Context Pack boundary",
      acceptanceCriteria: ["No placeholder Context Pack is accepted"],
      constraints: ["Require current workspace sources"],
      risk: "medium",
      mutationAuthority: "workspace-write:codex-mission-control",
      releaseRequired: false,
      releaseAuthority: "mission-owner",
    },
    actor: "mission-owner",
    reason: "Create a Mission awaiting Context capture",
  });
  return { id: created.id, events: created.events };
}

async function createObservedMissionHistory() {
  let eventNumber = 0;
  const source = createMissionOrchestrator({
    eventStore: createMemoryEventStore(),
    writeCoordinator: {
      runExclusive(operation) {
        return operation();
      },
    },
    agentRouter: createAgentRoutingAdapter({
      transport: {
        async *run() {
          yield {
            kind: "started",
            runId: "observed-run-001",
            occurredAt: "2026-08-28T09:01:00.000Z",
          };
          yield {
            kind: "completed",
            runId: "observed-run-001",
            occurredAt: "2026-08-28T09:02:00.000Z",
            summary: "Observed bounded Assignment completion",
            artifacts: [
              {
                name: "observed-output",
                uri: "artifact://observed-output",
              },
            ],
            evidence: [
              {
                ref: "evidence://observed-output",
                kind: "test",
                summary: "Observed test Evidence",
              },
            ],
          };
        },
      },
    }),
    clock: () => "2026-08-28T09:00:00.000Z",
    createId: (kind) =>
      kind === "mission" ? "mission-observed" : `event-${++eventNumber}`,
  });
  const created = source.createMission({
    brief: {
      goal: "Replay an observed Assignment after transport disconnects",
      scope: "Only a bounded historical Mission lifecycle",
      acceptanceCriteria: ["Historical observations remain readable"],
      constraints: ["Do not dispatch a synthetic agent"],
      risk: "low",
      mutationAuthority: "workspace-write:codex-mission-control",
      releaseRequired: false,
      releaseAuthority: "mission-owner",
    },
    actor: "mission-owner",
    reason: "Create an observed Mission",
  });
  source.execute(created.id, {
    type: "CAPTURE_CONTEXT",
    payload: {
      context: sourceBackedContext("Observed Context Pack"),
    },
    actor: "mission-owner",
    reason: "Capture the observed Context Pack",
  });
  source.execute(created.id, {
    type: "ACCEPT_PLAN",
    payload: { plan: { steps: ["route one bounded Assignment"] } },
    actor: "mission-owner",
    reason: "Accept the observed routing plan",
  });
  const observed = await source.dispatchAssignment(created.id, {
    assignment: {
      id: "observed-assignment",
      goal: "Read bounded historical observations",
      acceptanceCriteria: ["Return the observed history"],
      contextSlice: {
        summary: "Observed Context Pack",
        sourceRefs: ["tests/production-agent-bootstrap.test.js"],
      },
      ownershipBoundary: {
        readPaths: ["src/mission-orchestrator.js"],
        writePaths: [],
      },
      effectivePermission: "read-only",
      budget: { maxTurns: 1, maxMinutes: 1 },
      expectedEvidence: ["Observed test Evidence"],
      workKind: "deterministic",
      risk: "low",
    },
    actor: "mission-owner",
    reason: "Route one observed Assignment",
  });

  return { id: observed.id, events: observed.events };
}

async function createCompletedObservedMissionHistory() {
  const observed = await createObservedMissionHistory();
  const source = createMissionOrchestrator({
    eventStore: createMemoryEventStore({ [observed.id]: observed.events }),
    writeCoordinator: {
      runExclusive(operation) {
        return operation();
      },
    },
    clock: () => "2026-08-28T09:03:00.000Z",
    createId: (() => {
      let eventNumber = observed.events.length;
      return (kind) =>
        kind === "mission" ? observed.id : `event-${++eventNumber}`;
    })(),
  });
  const execute = (type, payload, reason, evidenceRefs = []) =>
    source.execute(observed.id, {
      type,
      payload,
      actor: "mission-owner",
      reason,
      evidenceRefs,
    });
  execute(
    "PASS_REVIEW",
    { review: { summary: "Observed output passed review" } },
    "Pass the observed review",
    ["evidence://observed-review"],
  );
  execute(
    "PASS_VALIDATION",
    { validation: { summary: "Observed output passed validation" } },
    "Pass the observed validation",
    ["evidence://observed-validation"],
  );
  execute(
    "CAPTURE_LEARNING",
    { learning: { summary: "Observed outcome is ready for retrospective" } },
    "Capture observed learning",
    ["evidence://observed-learning"],
  );
  const completed = execute(
    "COMPLETE_NO_RELEASE",
    { completion: { summary: "Accept the observed no-release outcome" } },
    "Complete the observed Mission",
    ["evidence://observed-completion"],
  );
  return { id: completed.id, events: completed.events };
}

function installDisconnectedPageEnvironment({ history = {}, href } = {}) {
  const values = new Map();
  const app = { innerHTML: "" };
  let runActionButtons = [];
  let playbookActionButtons = [];
  let promptCalls = 0;
  const inertElement = {
    addEventListener() {},
    close() {},
    focus() {},
    showModal() {},
  };
  const listeners = new Map();
  const restore = [
    replaceGlobal("document", {
      querySelector(selector) {
        return selector === "#app" ? app : inertElement;
      },
      querySelectorAll(selector) {
        if (selector === "[data-run-action]") {
          runActionButtons = [
            ...app.innerHTML.matchAll(
              /<button\b([^>]*\bdata-run-action="([^"]+)"[^>]*)>/g,
            ),
          ].map(([, attributes, action]) => {
            const listeners = new Map();
            return {
              addEventListener(type, listener) {
                listeners.set(type, listener);
              },
              dataset: { runAction: action },
              disabled: /\bdisabled(?:\s|=|$)/.test(attributes),
              listeners,
            };
          });
          return runActionButtons;
        }
        if (selector === "[data-playbook-action]") {
          playbookActionButtons = [
            ...app.innerHTML.matchAll(
              /<button\b([^>]*\bdata-playbook-action="([^"]+)"[^>]*)>/g,
            ),
          ].map(([, attributes, action]) => {
            const listeners = new Map();
            return {
              addEventListener(type, listener) {
                listeners.set(type, listener);
              },
              dataset: { playbookAction: action },
              disabled: /\bdisabled(?:\s|=|$)/.test(attributes),
              listeners,
            };
          });
          return playbookActionButtons;
        }
        return [];
      },
    }),
    replaceGlobal("window", {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      confirm() {
        return true;
      },
      history: { pushState() {} },
      location: { href: href ?? "https://mission-control.test/" },
      prompt() {
        promptCalls += 1;
        return null;
      },
      removeEventListener(type) {
        listeners.delete(type);
      },
    }),
    replaceGlobal("localStorage", {
      getItem(key) {
        return values.get(key) ?? null;
      },
      removeItem(key) {
        values.delete(key);
      },
      setItem(key, value) {
        values.set(key, String(value));
      },
    }),
    replaceGlobal("navigator", {
      locks: {
        request(_name, _options, operation) {
          return operation();
        },
      },
    }),
    replaceGlobal("addEventListener", () => {}),
    replaceGlobal("removeEventListener", () => {}),
    replaceGlobal("codexAgentTransport", undefined),
    replaceGlobal("codexContextCapture", undefined),
  ];

  values.set(
    "codex-mission-control-events-v1",
    JSON.stringify(history),
  );

  return {
    app,
    eventHistory() {
      return values.get("codex-mission-control-events-v1");
    },
    getRunAction(action) {
      return runActionButtons.find(
        (button) => button.dataset.runAction === action,
      );
    },
    getPlaybookAction(action) {
      return playbookActionButtons.find(
        (button) => button.dataset.playbookAction === action,
      );
    },
    promptCalls() {
      return promptCalls;
    },
    restore() {
      restore.reverse().forEach((restoreGlobal) => restoreGlobal());
    },
  };
}

test("production bootstrap renders an honest disconnected transport state when no transport exists", async () => {
  const environment = installDisconnectedPageEnvironment();

  try {
    await import(`../src/main.js?disconnected-bootstrap=${Date.now()}`);

    assert.match(
      environment.app.innerHTML,
      /Agent transport (?:is )?(?:disconnected|unavailable)/i,
    );
    assert.doesNotMatch(environment.app.innerHTML, /local observable simulator/i);
  } finally {
    environment.restore();
  }
});

test("production Brief form declares typed release validation gates", async () => {
  const environment = installDisconnectedPageEnvironment();

  try {
    await import(`../src/main.js?release-gate-brief=${Date.now()}`);

    assert.match(environment.app.innerHTML, /name="requiredValidationGates"/);
    assert.match(environment.app.innerHTML, /unit-tests/);
    assert.match(environment.app.innerHTML, /integration-tests/);
  } finally {
    environment.restore();
  }
});

test("production bootstrap disables Context capture when workspace sources are unavailable", async () => {
  const brief = createBriefMissionHistory();
  const environment = installDisconnectedPageEnvironment({
    history: { [brief.id]: brief.events },
    href: `https://mission-control.test/?mission=${brief.id}&view=detail`,
  });

  try {
    await import(`../src/main.js?context-unavailable=${Date.now()}`);

    const captureContext = environment.getRunAction("capture_context");
    assert.ok(captureContext, "the Brief exposes its Context capture control");
    assert.equal(captureContext.disabled, true);

    const historyBeforeCapture = environment.eventHistory();
    await captureContext.listeners.get("click")({
      currentTarget: captureContext,
    });
    assert.equal(environment.eventHistory(), historyBeforeCapture);
    assert.match(environment.app.innerHTML, /Context capture is unavailable/i);
  } finally {
    environment.restore();
  }
});

test("production bootstrap disables Context revision when workspace sources are unavailable", async () => {
  const planned = createPlannedMissionHistory();
  const environment = installDisconnectedPageEnvironment({
    history: { [planned.id]: planned.events },
    href: `https://mission-control.test/?mission=${planned.id}&view=detail`,
  });

  try {
    await import(`../src/main.js?context-revision-unavailable=${Date.now()}`);

    const reviseContext = environment.getRunAction("revise_context");
    assert.ok(reviseContext, "the planned Mission exposes Context revision");
    assert.equal(reviseContext.disabled, true);

    const historyBeforeRevision = environment.eventHistory();
    await reviseContext.listeners.get("click")({ currentTarget: reviseContext });
    assert.equal(environment.eventHistory(), historyBeforeRevision);
    assert.match(environment.app.innerHTML, /Context capture is unavailable/i);
  } finally {
    environment.restore();
  }
});

test("disconnected bootstrap disables and rejects a legacy Run dispatch before event persistence", async () => {
  const planned = createPlannedMissionHistory();
  const environment = installDisconnectedPageEnvironment({
    history: { [planned.id]: planned.events },
    href: `https://mission-control.test/?mission=${planned.id}&view=detail`,
  });

  try {
    await import(`../src/main.js?disconnected-dispatch=${Date.now()}`);

    const startRun = environment.getRunAction("start_run");
    assert.ok(startRun, "the planned Mission exposes its Run control");
    assert.equal(startRun.disabled, true);

    const historyBeforeDispatch = environment.eventHistory();
    await startRun.listeners.get("click")({ currentTarget: startRun });
    assert.equal(environment.eventHistory(), historyBeforeDispatch);
    assert.match(environment.app.innerHTML, /Agent transport is disconnected/i);
  } finally {
    environment.restore();
  }
});

test("disconnected bootstrap labels replayed observations as historical instead of connected", async () => {
  const observed = await createObservedMissionHistory();
  const environment = installDisconnectedPageEnvironment({
    history: { [observed.id]: observed.events },
  });

  try {
    await import(`../src/main.js?disconnected-history=${Date.now()}`);

    assert.match(environment.app.innerHTML, /Agent transport disconnected/i);
    assert.match(environment.app.innerHTML, /Assignment \/ Run observations/i);
  } finally {
    environment.restore();
  }
});

test("production Playbook evaluation derives Mission observations without prompting for JSON", async () => {
  const completed = await createCompletedObservedMissionHistory();
  const environment = installDisconnectedPageEnvironment({
    history: { [completed.id]: completed.events },
    href: `https://mission-control.test/?mission=${completed.id}&view=playbook`,
  });

  try {
    await import(`../src/main.js?observed-playbook-evaluation=${Date.now()}`);

    const evaluate = environment.getPlaybookAction(
      "evaluate_playbook_candidate",
    );
    assert.ok(evaluate, "the completed Mission exposes Playbook evaluation");

    const historyBeforeEvaluation = environment.eventHistory();
    await evaluate.listeners.get("click")({ currentTarget: evaluate });

    assert.equal(environment.promptCalls(), 0);
    assert.equal(environment.eventHistory(), historyBeforeEvaluation);
  } finally {
    environment.restore();
  }
});
