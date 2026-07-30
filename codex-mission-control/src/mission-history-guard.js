function latestEventTime(mission) {
  return mission.events.at(-1)?.occurredAt ?? "";
}

export function readMissionHistory(orchestrator) {
  try {
    const missions = orchestrator.listMissions().sort((left, right) =>
      latestEventTime(right).localeCompare(latestEventTime(left)),
    );
    return Object.freeze({
      missions: Object.freeze(missions),
      error: null,
      canCreateMission: true,
    });
  } catch (error) {
    return Object.freeze({
      missions: Object.freeze([]),
      error,
      canCreateMission: false,
    });
  }
}

export function createMissionWhenHistoryReadable(orchestrator, command) {
  const history = readMissionHistory(orchestrator);
  if (!history.canCreateMission) {
    throw new Error(
      `Mission creation is disabled while local event history cannot be replayed: ${history.error.message}`,
    );
  }
  return orchestrator.createMission(command);
}
