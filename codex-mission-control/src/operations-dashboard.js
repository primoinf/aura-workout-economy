const AGENT_FILTERS = new Set([
  "orchestrator",
  "luna_worker",
  "terra_builder",
  "terra_debugger",
  "sol_architect",
  "sol_reviewer",
]);

const STATE_FILTERS = new Set([
  "BRIEF_ACCEPTED",
  "CONTEXT_READY",
  "PLANNED",
  "RUNNING",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "VALIDATING",
  "APPROVAL_REQUIRED",
  "READY_TO_RELEASE",
  "LEARNING",
  "READY_TO_COMPLETE",
  "COMPLETED",
  "BLOCKED",
  "CANCELLED",
]);

const RISK_FILTERS = new Set(["low", "medium", "high"]);
const TIME_FILTERS = new Set(["all", "24h", "7d", "30d"]);
const TIME_WINDOWS = Object.freeze({
  "24h": 24 * 60 * 60 * 1_000,
  "7d": 7 * 24 * 60 * 60 * 1_000,
  "30d": 30 * 24 * 60 * 60 * 1_000,
});
const FILTER_PARAM_NAMES = Object.freeze([
  "missionFilter",
  "agent",
  "state",
  "risk",
  "time",
]);
const TERMINAL_STATES = new Set(["COMPLETED", "CANCELLED"]);
const PASSING_GATE_EVENTS = new Set([
  "REVIEW_PASSED",
  "VALIDATION_PASSED",
  "RELEASE_APPROVED",
  "PLAYBOOK_INDEPENDENT_REVIEW_RECORDED",
  "PLAYBOOK_PROMOTED",
]);
const FAILING_GATE_EVENTS = new Set([
  "REVIEW_REJECTED",
  "VALIDATION_FAILED",
  "RELEASE_REJECTED",
  "PLAYBOOK_INDEPENDENT_REVIEW_REJECTED",
  "PLAYBOOK_REJECTED",
]);

export const DASHBOARD_FILTER_DEFAULTS = Object.freeze({
  mission: "",
  agent: "all",
  state: "all",
  risk: "all",
  time: "all",
});

function normalizedChoice(value, choices, fallback = "all") {
  return choices.has(value) ? value : fallback;
}

export function parseDashboardFilters(search = "") {
  const params = new URLSearchParams(search);
  return Object.freeze({
    mission: (params.get("missionFilter") ?? "").trim(),
    agent: normalizedChoice(params.get("agent"), AGENT_FILTERS),
    state: normalizedChoice(params.get("state"), STATE_FILTERS),
    risk: normalizedChoice(params.get("risk"), RISK_FILTERS),
    time: normalizedChoice(params.get("time"), TIME_FILTERS),
  });
}

export function serializeDashboardFilters(filters, search = "") {
  const params = new URLSearchParams(search);
  for (const name of FILTER_PARAM_NAMES) params.delete(name);
  const normalized = {
    ...DASHBOARD_FILTER_DEFAULTS,
    ...filters,
  };
  if (normalized.mission.trim()) {
    params.set("missionFilter", normalized.mission.trim());
  }
  if (normalized.agent !== "all") params.set("agent", normalized.agent);
  if (normalized.state !== "all") params.set("state", normalized.state);
  if (normalized.risk !== "all") params.set("risk", normalized.risk);
  if (normalized.time !== "all") params.set("time", normalized.time);
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

function latestEvent(mission) {
  return mission.events.at(-1) ?? null;
}

function sourceForEvent(mission, event, label) {
  return Object.freeze({
    missionId: mission.id,
    eventSequence: event.sequence,
    eventType: event.type,
    evidenceRefs: Object.freeze([...(event.evidenceRefs ?? [])]),
    label,
  });
}

function latestSource(mission, label) {
  const event = latestEvent(mission);
  return event ? sourceForEvent(mission, event, label) : null;
}

function observedAgentRoles(mission) {
  return new Set([
    mission.agent?.roleId,
    ...(mission.execution?.nodes ?? []).map((node) => node.agent?.roleId),
  ].filter(Boolean));
}

function latestEventTimestamp(mission) {
  return Date.parse(latestEvent(mission)?.occurredAt ?? "");
}

function matchesFilters(mission, filters, nowTimestamp) {
  const needle = filters.mission.toLocaleLowerCase();
  if (
    needle &&
    ![mission.id, mission.brief.goal, mission.brief.scope]
      .filter(Boolean)
      .some((value) => value.toLocaleLowerCase().includes(needle))
  ) {
    return false;
  }
  if (
    filters.agent !== "all" &&
    !observedAgentRoles(mission).has(filters.agent)
  ) {
    return false;
  }
  if (filters.state !== "all" && mission.status !== filters.state) {
    return false;
  }
  if (filters.risk !== "all" && mission.brief.risk !== filters.risk) {
    return false;
  }
  if (filters.time !== "all") {
    const timestamp = latestEventTimestamp(mission);
    if (
      !Number.isFinite(timestamp) ||
      nowTimestamp - timestamp > TIME_WINDOWS[filters.time] ||
      timestamp > nowTimestamp
    ) {
      return false;
    }
  }
  return true;
}

function availableMetric(label, value, sources, explanation) {
  return Object.freeze({
    label,
    value,
    status: "observed",
    sources: Object.freeze(sources.filter(Boolean)),
    explanation,
  });
}

function unavailableMetric(label, explanation) {
  return Object.freeze({
    label,
    value: null,
    status: "unavailable",
    sources: Object.freeze([]),
    explanation,
  });
}

function metricUniverseSources(missions, label) {
  return missions.map((mission) => latestSource(mission, label)).filter(Boolean);
}

function deriveMetrics(missions) {
  const universeSources = metricUniverseSources(
    missions,
    "Included by the current dashboard filters",
  );
  const current = missions.filter(
    (mission) => !TERMINAL_STATES.has(mission.status),
  );
  const capacityMissions = missions.filter((mission) =>
    Number.isFinite(mission.execution?.capacity),
  );
  const capacities = capacityMissions.map(
    (mission) => mission.execution.capacity,
  );
  const queued = missions.flatMap((mission) =>
    (mission.execution?.nodes ?? [])
      .filter((node) => ["PENDING", "ASSIGNED"].includes(node.status))
      .map(() => latestSource(mission, "Queued Assignment state")),
  );
  const gateEvents = missions.flatMap((mission) =>
    mission.events
      .filter(
        (event) =>
          PASSING_GATE_EVENTS.has(event.type) ||
          FAILING_GATE_EVENTS.has(event.type),
      )
      .map((event) => ({ mission, event })),
  );
  const passingGates = gateEvents.filter(({ event }) =>
    PASSING_GATE_EVENTS.has(event.type),
  );
  const cycleDurations = missions
    .map((mission) => {
      const startedAt = Date.parse(mission.events[0]?.occurredAt ?? "");
      const endedAt = latestEventTimestamp(mission);
      return Number.isFinite(startedAt) &&
        Number.isFinite(endedAt) &&
        endedAt >= startedAt
        ? { mission, duration: endedAt - startedAt }
        : null;
    })
    .filter(Boolean);
  const tokenEvents = missions.flatMap((mission) =>
    mission.events
      .map((event) => ({
        mission,
        event,
        value:
          event.data?.metrics?.tokenUse ??
          event.data?.run?.metrics?.tokenUse ??
          event.data?.run?.usage?.tokenUse ??
          null,
      }))
      .filter(({ value }) => Number.isFinite(value)),
  );
  const retryEvents = missions.flatMap((mission) =>
    mission.events
      .filter((event) => event.type === "EXECUTION_ASSIGNMENT_RETRIED")
      .map((event) => ({ mission, event })),
  );
  const conflictSources = missions.flatMap((mission) =>
    (mission.execution?.waves ?? []).flatMap((wave) =>
      (wave.serializedAssignmentIds ?? []).map(() =>
        latestSource(mission, `Ownership conflict serialized in ${wave.id}`),
      ),
    ),
  );
  const approvals = missions.filter(
    (mission) =>
      mission.status === "APPROVAL_REQUIRED" ||
      mission.playbook?.status === "REVIEW_APPROVED",
  );

  return Object.freeze({
    currentMissions: availableMetric(
      "Current Missions",
      current.length,
      current.length
        ? current.map((mission) => latestSource(mission, "Current Mission state"))
        : universeSources,
      "Count of non-terminal Missions in the filtered event history.",
    ),
    agentCapacity: capacities.length
      ? availableMetric(
          "Agent capacity",
          Math.max(...capacities),
          capacityMissions.map((mission) =>
            latestSource(mission, "Observed execution capacity"),
          ),
          "Highest replayed execution capacity; no capacity is invented for Missions without execution telemetry.",
        )
      : unavailableMetric(
          "Agent capacity",
          "Execution capacity was not recorded for the filtered Missions.",
        ),
    queuedAssignments: availableMetric(
      "Queue",
      queued.length,
      queued.length ? queued : universeSources,
      "Pending or assigned execution nodes in replayed Task Graphs.",
    ),
    gateHealth: gateEvents.length
      ? availableMetric(
          "Gate health",
          `${passingGates.length}/${gateEvents.length} passing`,
          gateEvents.map(({ mission, event }) =>
            sourceForEvent(mission, event, "Gate outcome"),
          ),
          "Passing review, validation, release, and Playbook gate events over all observed gate outcomes.",
        )
      : unavailableMetric(
          "Gate health",
          "No review, validation, release, or Playbook gate outcome was recorded.",
        ),
    averageCycleTimeMs: cycleDurations.length
      ? availableMetric(
          "Cycle time",
          Math.round(
            cycleDurations.reduce((total, item) => total + item.duration, 0) /
              cycleDurations.length,
          ),
          cycleDurations.map(({ mission }) =>
            latestSource(mission, "First-to-latest event cycle time"),
          ),
          "Mean elapsed time from each Mission's first event to its latest replayed event.",
        )
      : unavailableMetric(
          "Cycle time",
          "A valid first-to-latest event interval was not recorded.",
        ),
    tokenUse: tokenEvents.length
      ? availableMetric(
          "Token use",
          tokenEvents.reduce((total, item) => total + item.value, 0),
          tokenEvents.map(({ mission, event }) =>
            sourceForEvent(mission, event, "Observed token-use metric"),
          ),
          "Sum of explicitly recorded token-use metrics; absent runtime telemetry is excluded.",
        )
      : unavailableMetric(
          "Token use",
          "Token use was not recorded by the runtime events.",
        ),
    retries: availableMetric(
      "Retries",
      retryEvents.length,
      retryEvents.length
        ? retryEvents.map(({ mission, event }) =>
            sourceForEvent(mission, event, "Explicit retry"),
          )
        : universeSources,
      "Explicit execution retry events in the filtered history.",
    ),
    ownershipConflicts: availableMetric(
      "Ownership conflicts",
      conflictSources.length,
      conflictSources.length ? conflictSources : universeSources,
      "Assignments serialized by replayed execution waves because their write ownership overlapped.",
    ),
    approvalDemand: availableMetric(
      "Approval demand",
      approvals.length,
      approvals.length
        ? approvals.map((mission) => latestSource(mission, "Pending human approval"))
        : universeSources,
      "Release or Playbook decisions currently awaiting explicit human authority.",
    ),
  });
}

export function deriveOperationsDashboard(
  missions,
  filters = DASHBOARD_FILTER_DEFAULTS,
  { now = new Date().toISOString() } = {},
) {
  const normalizedFilters = Object.freeze({
    ...DASHBOARD_FILTER_DEFAULTS,
    ...filters,
  });
  const nowTimestamp = Date.parse(now);
  if (!Number.isFinite(nowTimestamp)) {
    throw new Error("Dashboard derivation requires a valid current time.");
  }
  const filtered = [...missions]
    .filter((mission) => matchesFilters(mission, normalizedFilters, nowTimestamp))
    .sort((left, right) =>
      (latestEvent(right)?.occurredAt ?? "").localeCompare(
        latestEvent(left)?.occurredAt ?? "",
      ),
    );
  const summaries = filtered.map((mission) => {
    const source = latestSource(mission, "Latest observable Mission state");
    return Object.freeze({
      id: mission.id,
      goal: mission.brief.goal,
      scope: mission.brief.scope,
      risk: mission.brief.risk,
      status: mission.status,
      latestEvent: mission.events.at(-1),
      observedAgents: Object.freeze([...observedAgentRoles(mission)]),
      source,
    });
  });
  return Object.freeze({
    filters: normalizedFilters,
    resultCount: summaries.length,
    missions: Object.freeze(summaries),
    metrics: deriveMetrics(filtered),
  });
}
