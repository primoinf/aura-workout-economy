import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_FILTER_DEFAULTS,
  deriveOperationsDashboard,
  parseDashboardFilters,
  serializeDashboardFilters,
} from "../src/operations-dashboard.js";

function event(sequence, type, occurredAt, overrides = {}) {
  return {
    id: `event-${sequence}`,
    missionId: overrides.missionId ?? "mission-alpha",
    sequence,
    type,
    actor: overrides.actor ?? "mission-owner",
    occurredAt,
    reason: overrides.reason ?? `Record ${type}`,
    evidenceRefs: overrides.evidenceRefs ?? [],
    data: overrides.data ?? {},
  };
}

function mission(overrides = {}) {
  const id = overrides.id ?? "mission-alpha";
  return {
    id,
    brief: {
      goal: overrides.goal ?? "Ship accessible Mission search",
      scope: "Mission operations UI",
      risk: overrides.risk ?? "medium",
      releaseRequired: overrides.releaseRequired ?? false,
      releaseAuthority: "mission-owner",
    },
    status: overrides.status ?? "RUNNING",
    events:
      overrides.events ??
      [
        event(1, "MISSION_CREATED", "2026-08-27T10:00:00.000Z", {
          missionId: id,
        }),
      ],
    execution: overrides.execution ?? null,
    playbook: overrides.playbook ?? null,
  };
}

test("dashboard filters round-trip through the URL and discard unsupported values", () => {
  const parsed = parseDashboardFilters(
    "?view=overview&missionFilter=search&agent=terra_builder&state=RUNNING&risk=high&time=7d",
  );

  assert.deepEqual(parsed, {
    mission: "search",
    agent: "terra_builder",
    state: "RUNNING",
    risk: "high",
    time: "7d",
  });

  assert.equal(
    serializeDashboardFilters(parsed, "?view=overview&mission=mission-alpha"),
    "?view=overview&mission=mission-alpha&missionFilter=search&agent=terra_builder&state=RUNNING&risk=high&time=7d",
  );

  assert.deepEqual(
    parseDashboardFilters(
      "?agent=unknown&state=NOT_REAL&risk=urgent&time=forever",
    ),
    DASHBOARD_FILTER_DEFAULTS,
  );
  assert.equal(parseDashboardFilters("?state=BRIEF_ACCEPTED").state, "BRIEF_ACCEPTED");
  assert.equal(parseDashboardFilters("?state=IN_REVIEW").state, "IN_REVIEW");
});

test("Mission, agent, lifecycle, risk, and time filters select only matching observable Missions", () => {
  const matching = mission({
    id: "mission-alpha",
    goal: "Accessible command deck",
    risk: "high",
    events: [
      event(1, "MISSION_CREATED", "2026-08-27T10:00:00.000Z"),
      event(2, "EXECUTION_RUN_STARTED", "2026-08-27T11:00:00.000Z", {
        data: { assignmentId: "build-ui" },
      }),
    ],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      nodes: [
        {
          assignment: { id: "build-ui", goal: "Build UI" },
          status: "RUNNING",
          agent: { roleId: "terra_builder" },
          run: { status: "WORKING" },
        },
      ],
      frontier: [],
      waves: [],
    },
  });
  const wrongRole = mission({
    id: "mission-beta",
    goal: "Accessible audit ledger",
    risk: "high",
    events: [
      event(1, "MISSION_CREATED", "2026-08-27T12:00:00.000Z", {
        missionId: "mission-beta",
      }),
    ],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      nodes: [
        {
          assignment: { id: "audit", goal: "Audit" },
          status: "RUNNING",
          agent: { roleId: "sol_reviewer" },
          run: { status: "WORKING" },
        },
      ],
      frontier: [],
      waves: [],
    },
  });
  const tooOld = mission({
    id: "mission-old",
    goal: "Accessible archived flow",
    risk: "high",
    events: [
      event(1, "MISSION_CREATED", "2026-08-01T12:00:00.000Z", {
        missionId: "mission-old",
      }),
    ],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      nodes: [
        {
          assignment: { id: "old-ui", goal: "Old UI" },
          status: "RUNNING",
          agent: { roleId: "terra_builder" },
          run: { status: "WORKING" },
        },
      ],
      frontier: [],
      waves: [],
    },
  });

  const model = deriveOperationsDashboard(
    [matching, wrongRole, tooOld],
    {
      mission: "accessible",
      agent: "terra_builder",
      state: "RUNNING",
      risk: "high",
      time: "7d",
    },
    { now: "2026-08-27T13:00:00.000Z" },
  );

  assert.deepEqual(model.missions.map((item) => item.id), ["mission-alpha"]);
  assert.equal(model.resultCount, 1);
});

test("operational aggregates expose their exact event and Evidence provenance and stay unavailable when telemetry is absent", () => {
  const completed = mission({
    id: "mission-complete",
    goal: "Complete auditable release",
    status: "COMPLETED",
    releaseRequired: true,
    events: [
      event(1, "MISSION_CREATED", "2026-08-27T08:00:00.000Z", {
        missionId: "mission-complete",
      }),
      event(2, "EXECUTION_ASSIGNMENT_RETRIED", "2026-08-27T08:30:00.000Z", {
        missionId: "mission-complete",
        evidenceRefs: ["evidence://retry"],
      }),
      event(3, "REVIEW_PASSED", "2026-08-27T09:00:00.000Z", {
        missionId: "mission-complete",
        evidenceRefs: ["evidence://review"],
      }),
      event(4, "VALIDATION_PASSED", "2026-08-27T09:30:00.000Z", {
        missionId: "mission-complete",
        evidenceRefs: ["evidence://validation"],
      }),
      event(5, "MISSION_COMPLETED", "2026-08-27T10:00:00.000Z", {
        missionId: "mission-complete",
        data: { metrics: { tokenUse: 1250 } },
      }),
    ],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      frontier: [],
      waves: [
        {
          id: "wave-1",
          serializedAssignmentIds: ["write-shared-file"],
        },
      ],
      nodes: [
        {
          assignment: { id: "build", goal: "Build" },
          status: "COMPLETED",
          agent: { roleId: "terra_builder" },
          run: { status: "COMPLETED" },
        },
      ],
    },
  });
  const awaitingApproval = mission({
    id: "mission-approval",
    goal: "Await human approval",
    status: "APPROVAL_REQUIRED",
    releaseRequired: true,
    events: [
      event(1, "MISSION_CREATED", "2026-08-27T11:00:00.000Z", {
        missionId: "mission-approval",
      }),
      event(2, "VALIDATION_PASSED", "2026-08-27T12:00:00.000Z", {
        missionId: "mission-approval",
        evidenceRefs: ["evidence://approval-ready"],
      }),
    ],
    execution: {
      capacity: 4,
      reservedSlots: 1,
      frontier: ["queued-review"],
      waves: [],
      nodes: [
        {
          assignment: { id: "queued-review", goal: "Review" },
          status: "PENDING",
          agent: null,
          run: null,
        },
      ],
    },
  });

  const model = deriveOperationsDashboard(
    [completed, awaitingApproval],
    DASHBOARD_FILTER_DEFAULTS,
    { now: "2026-08-27T13:00:00.000Z" },
  );

  assert.deepEqual(
    Object.fromEntries(
      Object.entries(model.metrics).map(([key, metric]) => [key, metric.value]),
    ),
    {
      currentMissions: 1,
      agentCapacity: 4,
      queuedAssignments: 1,
      gateHealth: "3/3 passing",
      averageCycleTimeMs: 5400000,
      tokenUse: 1250,
      retries: 1,
      ownershipConflicts: 1,
      approvalDemand: 1,
    },
  );
  for (const metric of Object.values(model.metrics)) {
    assert.ok(metric.sources.length > 0, `${metric.label} must expose sources`);
    assert.ok(
      metric.sources.every(
        (source) => source.missionId && Number.isInteger(source.eventSequence),
      ),
      `${metric.label} must bind every source to an event`,
    );
  }
  assert.deepEqual(
    model.metrics.gateHealth.sources.find(
      (source) => source.eventType === "REVIEW_PASSED",
    ).evidenceRefs,
    ["evidence://review"],
  );

  const noTelemetry = deriveOperationsDashboard(
    [mission()],
    DASHBOARD_FILTER_DEFAULTS,
    { now: "2026-08-27T13:00:00.000Z" },
  );
  assert.equal(noTelemetry.metrics.tokenUse.value, null);
  assert.equal(noTelemetry.metrics.tokenUse.status, "unavailable");
  assert.match(noTelemetry.metrics.tokenUse.explanation, /not recorded/i);
});

test("approval demand counts reviewed Playbook Candidates awaiting a human, not review requests", () => {
  const awaitingIndependentReview = mission({
    id: "mission-playbook-review",
    status: "COMPLETED",
    playbook: { status: "PROMOTION_REQUESTED" },
    events: [
      event(1, "MISSION_CREATED", "2026-08-27T10:00:00.000Z", {
        missionId: "mission-playbook-review",
      }),
      event(2, "PLAYBOOK_PROMOTION_REQUESTED", "2026-08-27T11:00:00.000Z", {
        missionId: "mission-playbook-review",
      }),
    ],
  });
  const awaitingHumanDecision = mission({
    id: "mission-playbook-approval",
    status: "COMPLETED",
    playbook: { status: "REVIEW_APPROVED" },
    events: [
      event(1, "MISSION_CREATED", "2026-08-27T10:00:00.000Z", {
        missionId: "mission-playbook-approval",
      }),
      event(
        2,
        "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
        "2026-08-27T12:00:00.000Z",
        {
          missionId: "mission-playbook-approval",
          actor: "agent:sol_reviewer",
          evidenceRefs: ["evidence://playbook-review"],
        },
      ),
    ],
  });

  const model = deriveOperationsDashboard(
    [awaitingIndependentReview, awaitingHumanDecision],
    DASHBOARD_FILTER_DEFAULTS,
    { now: "2026-08-27T13:00:00.000Z" },
  );

  assert.equal(model.metrics.approvalDemand.value, 1);
  assert.deepEqual(
    model.metrics.approvalDemand.sources.map((source) => source.missionId),
    ["mission-playbook-approval"],
  );
});
