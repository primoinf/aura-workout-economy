import {
  assertValidAgentAssignment,
  canonicalOwnershipPath,
} from "./agent-assignment.js";
import { routeAgentAssignment } from "./agent-routing-adapter.js";

const ACTIVE_STATUSES = new Set(["ASSIGNED", "WORKING"]);
const DECISION_PARTICIPANT_ROLES = new Set([
  "orchestrator",
  "luna_worker",
  "terra_builder",
  "terra_debugger",
  "sol_architect",
  "sol_reviewer",
]);

function clone(value) {
  return structuredClone(value);
}

function sameStrings(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function writableAssignmentsOverlap(leftAssignment, rightAssignment) {
  const leftPaths = leftAssignment.ownershipBoundary.writePaths.map(
    canonicalOwnershipPath,
  );
  const rightPaths = rightAssignment.ownershipBoundary.writePaths.map(
    canonicalOwnershipPath,
  );
  return leftPaths.some((leftPath) =>
    rightPaths.some(
      (rightPath) =>
        leftPath === rightPath ||
        leftPath.startsWith(`${rightPath}/`) ||
        rightPath.startsWith(`${leftPath}/`),
    ),
  );
}

function writablePathsOverlap(left, right) {
  return writableAssignmentsOverlap(left.assignment, right.assignment);
}

function prerequisiteEvidenceRefs(node, nodesById) {
  return node.dependsOn.flatMap(
    (dependency) => nodesById.get(dependency)?.evidenceRefs ?? [],
  );
}

function roomMatchesNextAttempt(room, node, nodesById) {
  if (
    room.status !== "RESOLVED" ||
    room.assignmentId !== node.assignment.id ||
    room.assignmentAttempt !== node.attempt + 1
  ) {
    return false;
  }
  if (node.dependsOn.length === 0) {
    return room.inputEvidenceRefs.length > 0;
  }
  return sameStrings(
    room.inputEvidenceRefs,
    prerequisiteEvidenceRefs(node, nodesById),
  );
}

export function nextDecisionRoomInput(execution) {
  const assignmentId = execution?.decisionRequiredAssignmentIds?.find(
    (candidateId) =>
      !execution.decisionRooms.some(
        (room) =>
          room.assignmentId === candidateId && room.status === "OPEN",
      ),
  );
  if (!assignmentId) {
    return null;
  }
  const nodesById = new Map(
    execution.nodes.map((node) => [node.assignment.id, node]),
  );
  const node = nodesById.get(assignmentId);
  if (!node) {
    throw new Error(
      `Decision-required Assignment ${assignmentId} is missing from the Task Graph.`,
    );
  }
  return {
    assignmentId,
    evidenceRefs: prerequisiteEvidenceRefs(node, nodesById),
  };
}

function assertIndependentReviewCoverage(taskGraph) {
  const reviewers = taskGraph.assignments.filter(
    (assignment) => assignment.workKind === "review",
  );
  if (reviewers.length !== 1) {
    throw new Error(
      "Task Graph requires exactly one independent review Assignment.",
    );
  }

  const reviewer = reviewers[0];
  if (
    reviewer.effectivePermission !== "read-only" ||
    reviewer.ownershipBoundary.writePaths.length > 0
  ) {
    throw new Error(
      "Task Graph review Assignment must declare read-only ownership.",
    );
  }
  if (
    taskGraph.assignments.some((assignment) =>
      assignment.dependsOn.includes(reviewer.id),
    )
  ) {
    throw new Error("Task Graph review Assignment must be terminal.");
  }

  const assignmentsById = new Map(
    taskGraph.assignments.map((assignment) => [assignment.id, assignment]),
  );
  const reviewedAssignmentIds = new Set();
  const collectDependencies = (assignmentId) => {
    for (const dependencyId of assignmentsById.get(assignmentId)?.dependsOn ?? []) {
      if (!reviewedAssignmentIds.has(dependencyId)) {
        reviewedAssignmentIds.add(dependencyId);
        collectDependencies(dependencyId);
      }
    }
  };
  collectDependencies(reviewer.id);
  const candidateAssignmentIds = taskGraph.assignments
    .filter((assignment) => assignment.workKind !== "review")
    .map((assignment) => assignment.id);
  if (
    candidateAssignmentIds.length === 0 ||
    candidateAssignmentIds.some(
      (assignmentId) => !reviewedAssignmentIds.has(assignmentId),
    )
  ) {
    throw new Error(
      "Task Graph review Assignment must transitively depend on every candidate Assignment.",
    );
  }
}

function assertTaskGraph(taskGraph, { requireIndependentReview = false } = {}) {
  if (!taskGraph || typeof taskGraph !== "object" || Array.isArray(taskGraph)) {
    throw new Error("Plan taskGraph is required.");
  }
  if (
    !Number.isInteger(taskGraph.capacity) ||
    taskGraph.capacity < 1 ||
    taskGraph.capacity > 4
  ) {
    throw new Error("Task Graph capacity must be an integer from 1 to 4.");
  }
  if (typeof taskGraph.coordinationRequired !== "boolean") {
    throw new Error("Task Graph coordinationRequired must be a boolean.");
  }
  if (taskGraph.coordinationRequired && taskGraph.capacity < 2) {
    throw new Error(
      "A coordinated Task Graph requires at least one worker slot in addition to the reserved Orchestrator slot.",
    );
  }
  if (
    !Array.isArray(taskGraph.assignments) ||
    taskGraph.assignments.length === 0
  ) {
    throw new Error("Task Graph requires at least one Assignment.");
  }

  const ids = taskGraph.assignments.map((assignment) => assignment?.id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Task Graph Assignment IDs must be unique.");
  }
  const knownIds = new Set(ids);
  for (const assignment of taskGraph.assignments) {
    assertValidAgentAssignment(assignment);
    if (
      assignment.requiresDecision !== undefined &&
      typeof assignment.requiresDecision !== "boolean"
    ) {
      throw new Error(
        `Task Graph Assignment ${assignment.id} requiresDecision must be a boolean.`,
      );
    }
    if (
      !Array.isArray(assignment.dependsOn) ||
      assignment.dependsOn.some(
        (dependency) =>
          typeof dependency !== "string" || dependency.trim() === "",
      )
    ) {
      throw new Error(
        `Task Graph Assignment ${assignment.id} dependsOn must be an array of IDs.`,
      );
    }
    if (new Set(assignment.dependsOn).size !== assignment.dependsOn.length) {
      throw new Error(
        `Task Graph Assignment ${assignment.id} has duplicate dependencies.`,
      );
    }
    if (assignment.dependsOn.includes(assignment.id)) {
      throw new Error(
        `Task Graph Assignment ${assignment.id} cannot depend on itself.`,
      );
    }
    const unknownDependency = assignment.dependsOn.find(
      (dependency) => !knownIds.has(dependency),
    );
    if (unknownDependency) {
      throw new Error(
        `Task Graph Assignment ${assignment.id} depends on unknown Assignment ${unknownDependency}.`,
      );
    }
  }

  const dependenciesById = new Map(
    taskGraph.assignments.map((assignment) => [
      assignment.id,
      assignment.dependsOn,
    ]),
  );
  const visiting = new Set();
  const visited = new Set();
  const visit = (assignmentId) => {
    if (visiting.has(assignmentId)) {
      throw new Error("Task Graph contains a dependency cycle.");
    }
    if (visited.has(assignmentId)) {
      return;
    }
    visiting.add(assignmentId);
    for (const dependency of dependenciesById.get(assignmentId)) {
      visit(dependency);
    }
    visiting.delete(assignmentId);
    visited.add(assignmentId);
  };
  for (const assignmentId of knownIds) {
    visit(assignmentId);
  }
  if (requireIndependentReview) {
    assertIndependentReviewCoverage(taskGraph);
  }
}

function refreshTaskExecution(execution) {
  const sourceNodesById = new Map(
    execution.nodes.map((node) => [node.assignment.id, node]),
  );
  const decisionRooms = execution.decisionRooms.map((room) => {
    const node = sourceNodesById.get(room.assignmentId);
    if (
      node &&
      ["OPEN", "RESOLVED"].includes(room.status) &&
      ["PENDING", "CHANGES_REQUESTED", "DECISION_REQUIRED"].includes(
        node.status,
      ) &&
      (room.assignmentAttempt !== node.attempt + 1 ||
        (node.dependsOn.length > 0 &&
          !sameStrings(
            room.inputEvidenceRefs,
            prerequisiteEvidenceRefs(node, sourceNodesById),
          )))
    ) {
      return { ...room, status: "STALE" };
    }
    return room;
  });
  const completed = new Set(
    execution.nodes
      .filter((node) => node.status === "COMPLETED")
      .map((node) => node.assignment.id),
  );
  const nodes = execution.nodes.map((node) => {
    const dependenciesComplete = node.dependsOn.every((dependency) =>
      completed.has(dependency),
    );
    const hasCurrentDecision = decisionRooms.some((room) =>
      roomMatchesNextAttempt(room, node, sourceNodesById),
    );
    if (
      ["PENDING", "CHANGES_REQUESTED"].includes(node.status) &&
      node.requiresDecision &&
      dependenciesComplete &&
      !hasCurrentDecision
    ) {
      return {
        ...node,
        status: "DECISION_REQUIRED",
        statusAfterDecision: node.status,
      };
    }
    if (
      node.status === "DECISION_REQUIRED" &&
      hasCurrentDecision
    ) {
      return {
        ...node,
        status: node.statusAfterDecision ?? "PENDING",
        statusAfterDecision: null,
      };
    }
    return node;
  });
  const activeAssignmentIds = nodes
    .filter((node) => ACTIVE_STATUSES.has(node.status))
    .map((node) => node.assignment.id);
  const frontier = nodes
    .filter(
      (node) =>
        ["PENDING", "CHANGES_REQUESTED"].includes(node.status) &&
        node.dependsOn.every((dependency) => completed.has(dependency)),
    )
    .map((node) => node.assignment.id);

  const nodesById = new Map(
    nodes.map((node) => [node.assignment.id, node]),
  );
  const waves = execution.waves.map((wave) => {
    if (
      [
        "COMPLETED",
        "BLOCKED",
        "ERROR",
        "INTERRUPTED",
        "CANCELLED",
      ].includes(wave.status)
    ) {
      return wave;
    }
    const statuses = wave.assignmentIds.map(
      (assignmentId) => nodesById.get(assignmentId)?.status,
    );
    const status = statuses.every((value) => value === "COMPLETED")
      ? "COMPLETED"
      : statuses.some((value) => value === "CANCELLED")
        ? "CANCELLED"
        : statuses.some((value) => value === "INTERRUPTED")
          ? "INTERRUPTED"
      : statuses.some((value) => value === "ERROR")
        ? "ERROR"
        : statuses.some((value) => value === "BLOCKED")
          ? "BLOCKED"
          : statuses.some((value) => ACTIVE_STATUSES.has(value))
            ? "WORKING"
            : wave.status;
    return { ...wave, status };
  });

  return {
    ...execution,
    nodes,
    decisionRooms,
    waves,
    activeAssignmentIds,
    availableWorkerSlots: Math.max(
      0,
      execution.workerCapacity - activeAssignmentIds.length,
    ),
    frontier,
    decisionRequiredAssignmentIds: nodes
      .filter((node) => node.status === "DECISION_REQUIRED")
      .map((node) => node.assignment.id),
  };
}

export function interruptTaskExecution(
  execution,
  { status, occurredAt, reason },
) {
  if (!["INTERRUPTED", "CANCELLED"].includes(status)) {
    throw new Error("Task execution interruption status is invalid.");
  }
  assertNonEmptyString(
    occurredAt,
    "Task execution interruption timestamp is required.",
  );
  assertNonEmptyString(reason, "Task execution interruption reason is required.");
  const next = clone(execution);
  next.nodes = next.nodes.map((node) => {
    if (!ACTIVE_STATUSES.has(node.status)) {
      return node;
    }
    return {
      ...node,
      status,
      run: {
        ...(node.run ? clone(node.run) : {}),
        id: node.run?.id ?? `unavailable:${node.assignment.id}`,
        status,
        updatedAt: occurredAt,
        interruptionReason: reason,
      },
    };
  });
  return refreshTaskExecution(next);
}

export function resumeInterruptedTaskExecution(execution) {
  const next = clone(execution);
  next.nodes = next.nodes.map((node) => {
    if (node.status !== "INTERRUPTED") {
      return node;
    }
    const attempt = {
      attempt: node.attempt,
      waveId: node.currentWaveId,
      status: node.status,
      run: clone(node.run),
      artifacts: clone(node.artifacts),
      evidenceRefs: clone(node.evidenceRefs),
    };
    return {
      ...node,
      status: "PENDING",
      currentWaveId: null,
      agent: null,
      run: null,
      artifacts: [],
      evidenceRefs: [],
      reviewOutcome: null,
      attempts: [...(node.attempts ?? []), attempt],
    };
  });
  return refreshTaskExecution(next);
}

export function planTaskExecutionWave(
  execution,
  {
    availableWorkerSlots = execution.availableWorkerSlots,
    concurrentAssignments = [],
  } = {},
) {
  if (
    !Number.isInteger(availableWorkerSlots) ||
    availableWorkerSlots < 0 ||
    availableWorkerSlots > 4
  ) {
    throw new Error("Execution planning worker slots must be from 0 to 4.");
  }
  if (!Array.isArray(concurrentAssignments)) {
    throw new Error("Execution planning concurrent Assignments are invalid.");
  }
  concurrentAssignments.forEach(assertValidAgentAssignment);
  const nodesById = new Map(
    execution.nodes.map((node) => [node.assignment.id, node]),
  );
  const activeNodes = execution.activeAssignmentIds.map((assignmentId) =>
    nodesById.get(assignmentId),
  );
  const externallyActiveNodes = concurrentAssignments.map((assignment) => ({
    assignment,
  }));
  const dispatchableSlots = Math.min(
    execution.availableWorkerSlots,
    availableWorkerSlots,
  );
  const selectedNodes = [];
  const serializedAssignmentIds = [];
  const deferredAssignmentIds = [];

  for (const assignmentId of execution.frontier) {
    const node = nodesById.get(assignmentId);
    if (selectedNodes.length >= dispatchableSlots) {
      deferredAssignmentIds.push(assignmentId);
      continue;
    }
    if (
      [...activeNodes, ...externallyActiveNodes, ...selectedNodes].some(
        (concurrentNode) =>
          writablePathsOverlap(node, concurrentNode),
      )
    ) {
      serializedAssignmentIds.push(assignmentId);
      continue;
    }
    selectedNodes.push(node);
  }

  return {
    capacity: execution.capacity,
    reservedSlots: execution.reservedSlots,
    workerCapacity: execution.workerCapacity,
    assignmentIds: selectedNodes.map((node) => node.assignment.id),
    serializedAssignmentIds,
    deferredAssignmentIds,
  };
}

function planningOptionsFromEvent(execution, event) {
  const context = event.data.planningContext;
  if (context === undefined) {
    return {};
  }
  if (
    !context ||
    typeof context !== "object" ||
    Array.isArray(context) ||
    context.globalCapacity !== 4 ||
    ![0, 1].includes(context.globalReservedSlots) ||
    context.globalWorkerCapacity !==
      context.globalCapacity - context.globalReservedSlots ||
    !Number.isInteger(context.globalActiveWorkerCount) ||
    context.globalActiveWorkerCount < 0 ||
    context.globalActiveWorkerCount > context.globalWorkerCapacity ||
    context.globalAvailableWorkerSlots !==
      context.globalWorkerCapacity - context.globalActiveWorkerCount ||
    !Array.isArray(context.concurrentAssignments)
  ) {
    throw new Error("Execution wave global planning context is invalid.");
  }
  const externalWorkerCount =
    context.globalActiveWorkerCount - execution.activeAssignmentIds.length;
  if (
    externalWorkerCount < 0 ||
    context.concurrentAssignments.length !== externalWorkerCount
  ) {
    throw new Error(
      "Execution wave global planning context does not match active Assignments.",
    );
  }
  context.concurrentAssignments.forEach(assertValidAgentAssignment);
  return {
    availableWorkerSlots: context.globalAvailableWorkerSlots,
    concurrentAssignments: context.concurrentAssignments,
  };
}

function assertWaveMatchesPlan(wave, expected) {
  if (
    !wave ||
    typeof wave.id !== "string" ||
    wave.id.trim() === "" ||
    wave.capacity !== expected.capacity ||
    wave.reservedSlots !== expected.reservedSlots ||
    wave.workerCapacity !== expected.workerCapacity ||
    !sameStrings(wave.assignmentIds, expected.assignmentIds) ||
    !sameStrings(
      wave.serializedAssignmentIds,
      expected.serializedAssignmentIds,
    ) ||
    !sameStrings(wave.deferredAssignmentIds, expected.deferredAssignmentIds)
  ) {
    throw new Error(
      "Execution wave does not match the current frontier, capacity, or ownership constraints.",
    );
  }
}

function projectWaveDispatch(execution, event) {
  const next = clone(execution);
  const expected = planTaskExecutionWave(
    next,
    planningOptionsFromEvent(next, event),
  );
  const { wave, routings } = event.data;
  assertWaveMatchesPlan(wave, expected);
  if (next.waves.some((candidate) => candidate.id === wave.id)) {
    throw new Error(`Execution wave ${wave.id} already exists.`);
  }
  if (
    expected.assignmentIds.length === 0 ||
    !Array.isArray(routings) ||
    routings.length !== expected.assignmentIds.length
  ) {
    throw new Error("Execution wave requires one routed agent per Assignment.");
  }

  for (const [index, assignmentId] of expected.assignmentIds.entries()) {
    const routing = routings[index];
    const node = next.nodes.find(
      (candidate) => candidate.assignment.id === assignmentId,
    );
    const expectedRouting = routeAgentAssignment(node.assignment);
    if (
      !routing ||
      routing.assignment?.id !== assignmentId ||
      !sameValue(routing, expectedRouting)
    ) {
      throw new Error(
        `Execution wave routing for Assignment ${assignmentId} does not match the canonical routing policy.`,
      );
    }
    node.agent = clone(expectedRouting.agent);
    node.status = "ASSIGNED";
    node.attempt += 1;
    node.currentWaveId = wave.id;
    node.run = null;
    node.artifacts = [];
    node.evidenceRefs = [];
    node.reviewOutcome = null;
  }
  next.waves.push({ ...clone(wave), status: "DISPATCHED" });
  return refreshTaskExecution(next);
}

function projectRunObservation(execution, event) {
  const next = clone(execution);
  const { assignmentId, waveId, attempt, run } = event.data;
  const node = next.nodes.find(
    (candidate) => candidate.assignment.id === assignmentId,
  );
  const wave = next.waves.find((candidate) => candidate.id === waveId);
  if (!node || !wave || !wave.assignmentIds.includes(assignmentId)) {
    throw new Error("Execution Run does not match a dispatched wave Assignment.");
  }
  if (
    !Number.isInteger(attempt) ||
    attempt < 1 ||
    node.currentWaveId !== waveId ||
    node.attempt !== attempt
  ) {
    throw new Error(
      "Execution Run does not match the Assignment's current wave and attempt.",
    );
  }
  const expectedActor =
    event.type === "EXECUTION_RUN_ERROR"
      ? "agent-router"
      : `agent:${node.agent?.roleId}`;
  if (!node.agent?.roleId || event.actor !== expectedActor) {
    throw new Error(
      "Execution Run actor does not match the Assignment's routed agent actor.",
    );
  }
  if (!run || typeof run.id !== "string" || run.id.trim() === "") {
    throw new Error("Execution Run ID is required.");
  }

  if (event.type === "EXECUTION_RUN_STARTED") {
    if (node.status !== "ASSIGNED" || run.status !== "WORKING") {
      throw new Error("Execution Run can start only from an assigned state.");
    }
    node.status = "WORKING";
    node.run = clone(run);
    return refreshTaskExecution(next);
  }
  if (!node.run || node.run.id !== run.id) {
    throw new Error("Execution Run observation does not match the active Run.");
  }
  if (event.type === "EXECUTION_RUN_UPDATED") {
    if (node.status !== "WORKING" || run.status !== "WORKING") {
      throw new Error("Execution Run update requires a working Run.");
    }
    node.run = clone(run);
    return refreshTaskExecution(next);
  }
  if (event.type === "EXECUTION_RUN_COMPLETED") {
    if (
      node.status !== "WORKING" ||
      run.status !== "COMPLETED" ||
      !Array.isArray(event.data.artifacts) ||
      event.data.artifacts.length === 0 ||
      !Array.isArray(run.evidence) ||
      run.evidence.length === 0 ||
      !sameStrings(
        run.evidence.map((item) => item.ref),
        event.evidenceRefs,
      )
    ) {
      throw new Error(
        "Completed execution Run requires current Artifacts and matching Evidence.",
      );
    }
    const reviewOutcome =
      node.assignment.workKind === "review"
        ? structuredReviewOutcome(next, node, event.data.artifacts)
        : null;
    node.status = "COMPLETED";
    node.run = clone(run);
    node.artifacts = clone(event.data.artifacts);
    node.evidenceRefs = clone(event.evidenceRefs);
    node.reviewOutcome = reviewOutcome;
    return refreshTaskExecution(next);
  }
  if (event.type === "EXECUTION_RUN_BLOCKED") {
    if (
      node.status !== "WORKING" ||
      run.status !== "BLOCKED" ||
      typeof run.blocker !== "string" ||
      run.blocker.trim() === "" ||
      !Array.isArray(run.attemptedAlternatives) ||
      run.attemptedAlternatives.length === 0 ||
      run.attemptedAlternatives.some(
        (alternative) =>
          typeof alternative !== "string" || alternative.trim() === "",
      ) ||
      typeof run.requiredAuthorityOrInput !== "string" ||
      run.requiredAuthorityOrInput.trim() === ""
    ) {
      throw new Error("Blocked execution Run requires a working Run.");
    }
    node.status = "BLOCKED";
    node.run = clone(run);
    return refreshTaskExecution(next);
  }
  if (event.type === "EXECUTION_RUN_ERROR") {
    if (
      !["ASSIGNED", "WORKING"].includes(node.status) ||
      run.status !== "ERROR" ||
      typeof run.error !== "string" ||
      run.error.trim() === ""
    ) {
      throw new Error("Execution Run error is invalid.");
    }
    node.status = "ERROR";
    node.run = clone(run);
    return refreshTaskExecution(next);
  }
  throw new Error(`Unknown Task Graph event: ${event.type}.`);
}

function projectExecutionRetry(execution, event) {
  const retry = event.data.retry;
  if (!retry || typeof retry !== "object" || Array.isArray(retry)) {
    throw new Error("Execution retry details are required.");
  }
  assertNonEmptyString(
    retry.assignmentId,
    "Execution retry Assignment ID is required.",
  );
  assertNonEmptyString(retry.summary, "Execution retry summary is required.");
  const next = clone(execution);
  const node = next.nodes.find(
    (candidate) => candidate.assignment.id === retry.assignmentId,
  );
  if (!node || !["BLOCKED", "ERROR", "INTERRUPTED"].includes(node.status)) {
    throw new Error(
      `Assignment ${retry.assignmentId} does not have a retryable terminal outcome.`,
    );
  }
  const attempt = node.run
    ? {
        attempt: node.attempt,
        waveId: node.currentWaveId,
        status: node.status,
        run: clone(node.run),
        artifacts: clone(node.artifacts),
        evidenceRefs: clone(node.evidenceRefs),
      }
    : null;
  node.status = "PENDING";
  node.currentWaveId = null;
  node.agent = null;
  node.run = null;
  node.artifacts = [];
  node.evidenceRefs = [];
  node.reviewOutcome = null;
  node.attempts = [
    ...(node.attempts ?? []),
    ...(attempt ? [attempt] : []),
  ];
  return refreshTaskExecution(next);
}

function assertNonEmptyString(value, message) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
}

function assertDecisionRoom(room) {
  if (!room || typeof room !== "object" || Array.isArray(room)) {
    throw new Error("A structured Decision Room is required.");
  }
  assertNonEmptyString(room.id, "Decision Room ID is required.");
  assertNonEmptyString(
    room.assignmentId,
    "Decision Room Assignment owner is required.",
  );
  if (!Number.isInteger(room.assignmentAttempt) || room.assignmentAttempt < 1) {
    throw new Error("Decision Room Assignment attempt is required.");
  }
  assertNonEmptyString(room.question, "Decision Room question is required.");
  if (
    !Array.isArray(room.participantRoles) ||
    room.participantRoles.length === 0 ||
    room.participantRoles.some(
      (roleId) =>
        typeof roleId !== "string" || !DECISION_PARTICIPANT_ROLES.has(roleId),
    )
  ) {
    throw new Error("Decision Room participant roles are invalid.");
  }
  if (
    !Array.isArray(room.participantInputs) ||
    room.participantInputs.length !== room.participantRoles.length
  ) {
    throw new Error("Decision Room participant inputs are required.");
  }
  const participantRoleSet = new Set(room.participantRoles);
  const participantInputRoleSet = new Set(
    room.participantInputs.map((input) => input?.roleId),
  );
  if (
    participantRoleSet.size !== room.participantRoles.length ||
    participantInputRoleSet.size !== room.participantInputs.length ||
    participantInputRoleSet.size !== participantRoleSet.size ||
    [...participantInputRoleSet].some(
      (roleId) => !participantRoleSet.has(roleId),
    )
  ) {
    throw new Error(
      "Decision Room participant roles must be unique and match participant inputs.",
    );
  }
  for (const participantRole of room.participantRoles) {
    const input = room.participantInputs.find(
      (candidate) => candidate?.roleId === participantRole,
    );
    if (!input) {
      throw new Error("Decision Room participant inputs are required.");
    }
    assertNonEmptyString(
      input.contribution,
      "Decision Room participant contribution is required.",
    );
    if (
      !Array.isArray(input.evidenceRefs) ||
      input.evidenceRefs.length === 0 ||
      input.evidenceRefs.some(
        (reference) =>
          typeof reference !== "string" || reference.trim() === "",
      )
    ) {
      throw new Error("Decision Room participant input Evidence is required.");
    }
  }
  assertNonEmptyString(
    room.expectedOutput,
    "Decision Room expected output is required.",
  );
  if (
    !Array.isArray(room.alternatives) ||
    room.alternatives.length === 0
  ) {
    throw new Error("Decision Room alternatives are required.");
  }
  for (const alternative of room.alternatives) {
    assertNonEmptyString(
      alternative?.id,
      "Decision Room alternative ID is required.",
    );
    assertNonEmptyString(
      alternative?.label,
      "Decision Room alternative label is required.",
    );
    if (
      !Array.isArray(alternative.tradeoffs) ||
      alternative.tradeoffs.length === 0 ||
      alternative.tradeoffs.some(
        (tradeoff) => typeof tradeoff !== "string" || tradeoff.trim() === "",
      )
    ) {
      throw new Error("Decision Room alternative trade-offs are required.");
    }
  }
  if (
    room.alternatives.length < 2 ||
    new Set(room.alternatives.map((alternative) => alternative.id)).size !==
      room.alternatives.length
  ) {
    throw new Error("Decision Room requires at least two unique alternatives.");
  }
  if (!room.recommendation || typeof room.recommendation !== "object") {
    throw new Error("Decision Room recommendation is required.");
  }
  assertNonEmptyString(
    room.recommendation.alternativeId,
    "Decision Room recommendation alternative is required.",
  );
  assertNonEmptyString(
    room.recommendation.rationale,
    "Decision Room recommendation rationale is required.",
  );
  if (
    !room.alternatives.some(
      (alternative) =>
        alternative.id === room.recommendation.alternativeId,
    )
  ) {
    throw new Error("Decision Room recommendation must name an alternative.");
  }
  if (
    !Array.isArray(room.validationPlan) ||
    room.validationPlan.length === 0 ||
    room.validationPlan.some(
      (step) => typeof step !== "string" || step.trim() === "",
    )
  ) {
    throw new Error("Decision Room validation plan is required.");
  }
}

function projectDecisionRoomOpened(execution, event) {
  const next = clone(execution);
  const room = event.data.decisionRoom;
  assertDecisionRoom(room);
  if (!Array.isArray(event.evidenceRefs) || !event.evidenceRefs.length) {
    throw new Error("Decision Room input Evidence is required.");
  }
  const participantEvidenceRefs = [
    ...new Set(room.participantInputs.flatMap((input) => input.evidenceRefs)),
  ];
  if (!sameStrings(participantEvidenceRefs, event.evidenceRefs)) {
    throw new Error(
      "Decision Room input Evidence must match the recorded participant inputs.",
    );
  }
  if (!next.decisionRequiredAssignmentIds.includes(room.assignmentId)) {
    throw new Error(
      `Assignment ${room.assignmentId} does not currently require a decision.`,
    );
  }
  const nodesById = new Map(
    next.nodes.map((node) => [node.assignment.id, node]),
  );
  const node = nodesById.get(room.assignmentId);
  if (room.assignmentAttempt !== node.attempt + 1) {
    throw new Error(
      `Decision Room for Assignment ${room.assignmentId} does not match its next attempt.`,
    );
  }
  const expectedInputEvidence = prerequisiteEvidenceRefs(node, nodesById);
  if (
    node.dependsOn.length > 0 &&
    !sameStrings(event.evidenceRefs, expectedInputEvidence)
  ) {
    throw new Error(
      "Decision Room input Evidence must match current prerequisite Evidence.",
    );
  }
  if (next.decisionRooms.some((candidate) => candidate.id === room.id)) {
    throw new Error(`Decision Room ${room.id} already exists.`);
  }
  if (
    next.decisionRooms.some(
      (candidate) =>
        candidate.assignmentId === room.assignmentId &&
        candidate.status === "OPEN",
    )
  ) {
    throw new Error(
      `Assignment ${room.assignmentId} already has an open Decision Room.`,
    );
  }
  next.decisionRooms.push({
    ...clone(room),
    inputEvidenceRefs: clone(event.evidenceRefs),
    status: "OPEN",
    decision: null,
    decisionArtifact: null,
  });
  return refreshTaskExecution(next);
}

function projectDecisionRoomResolved(execution, event) {
  const next = clone(execution);
  const decision = event.data.decision;
  if (!decision || typeof decision !== "object" || Array.isArray(decision)) {
    throw new Error("A Decision Room decision is required.");
  }
  assertNonEmptyString(decision.roomId, "Decision Room decision ID is required.");
  assertNonEmptyString(
    decision.selectedAlternativeId,
    "Decision Room selected alternative is required.",
  );
  assertNonEmptyString(
    decision.rationale,
    "Decision Room decision rationale is required.",
  );
  if (
    !Number.isInteger(decision.assignmentAttempt) ||
    decision.assignmentAttempt < 1
  ) {
    throw new Error("Decision Room decision Assignment attempt is required.");
  }
  const room = next.decisionRooms.find(
    (candidate) => candidate.id === decision.roomId,
  );
  if (!room || room.status !== "OPEN") {
    throw new Error(`Decision Room ${decision.roomId} is not open.`);
  }
  const nodesById = new Map(
    next.nodes.map((node) => [node.assignment.id, node]),
  );
  const node = nodesById.get(room.assignmentId);
  if (
    !node ||
    node.status !== "DECISION_REQUIRED" ||
    room.assignmentAttempt !== decision.assignmentAttempt ||
    decision.assignmentAttempt !== node.attempt + 1 ||
    (node.dependsOn.length > 0 &&
      !sameStrings(
        room.inputEvidenceRefs,
        prerequisiteEvidenceRefs(node, nodesById),
      ))
  ) {
    throw new Error(
      "Decision Room decision does not match the current Assignment attempt and Evidence.",
    );
  }
  if (
    !room.alternatives.some(
      (alternative) => alternative.id === decision.selectedAlternativeId,
    )
  ) {
    throw new Error("Decision Room decision must select a declared alternative.");
  }
  if (
    !decision.artifact ||
    typeof decision.artifact !== "object" ||
    Array.isArray(decision.artifact)
  ) {
    throw new Error("Decision Room decision Artifact is required.");
  }
  assertNonEmptyString(
    decision.artifact.id,
    "Decision Room decision Artifact ID is required.",
  );
  assertNonEmptyString(
    decision.artifact.uri,
    "Decision Room decision Artifact URI is required.",
  );
  assertNonEmptyString(
    decision.artifact.summary,
    "Decision Room decision Artifact summary is required.",
  );
  room.status = "RESOLVED";
  room.decision = {
    assignmentAttempt: decision.assignmentAttempt,
    selectedAlternativeId: decision.selectedAlternativeId,
    rationale: decision.rationale,
    actor: event.actor,
  };
  room.decisionArtifact = {
    id: decision.artifact.id,
    uri: decision.artifact.uri,
    summary: decision.artifact.summary,
    expectedOutput: room.expectedOutput,
    question: room.question,
    selectedAlternativeId: decision.selectedAlternativeId,
    rationale: decision.rationale,
    alternatives: clone(room.alternatives),
    validationPlan: clone(room.validationPlan),
    participantInputs: clone(room.participantInputs),
  };
  return refreshTaskExecution(next);
}

function artifactReference(artifact) {
  if (!artifact || typeof artifact !== "object") {
    return null;
  }
  return artifact.uri ?? artifact.path ?? artifact.ref ?? artifact.id ?? null;
}

function transitiveDependencyIds(node, nodesById) {
  const dependencyIds = new Set();
  const collect = (assignmentId) => {
    for (const dependencyId of nodesById.get(assignmentId)?.dependsOn ?? []) {
      if (!dependencyIds.has(dependencyId)) {
        dependencyIds.add(dependencyId);
        collect(dependencyId);
      }
    }
  };
  collect(node.assignment.id);
  return dependencyIds;
}

function structuredReviewOutcome(execution, reviewerNode, artifacts) {
  const outcomeArtifacts = artifacts.filter(
    (artifact) => artifact?.reviewOutcome !== undefined,
  );
  if (outcomeArtifacts.length !== 1) {
    throw new Error(
      "Independent review completion requires exactly one structured reviewer outcome Artifact.",
    );
  }
  const reviewOutcome = outcomeArtifacts[0].reviewOutcome;
  if (
    !reviewOutcome ||
    typeof reviewOutcome !== "object" ||
    Array.isArray(reviewOutcome) ||
    !["PASSED", "CHANGES_REQUESTED"].includes(reviewOutcome.outcome)
  ) {
    throw new Error("Structured reviewer outcome is invalid.");
  }

  const nodesById = new Map(
    execution.nodes.map((node) => [node.assignment.id, node]),
  );
  const dependencyIds = transitiveDependencyIds(reviewerNode, nodesById);
  const expectedCandidateArtifactRefs = execution.nodes
    .filter(
      (node) =>
        dependencyIds.has(node.assignment.id) &&
        node.assignment.workKind !== "review",
    )
    .flatMap((node) => node.artifacts.map(artifactReference));
  if (
    expectedCandidateArtifactRefs.some((reference) => !reference) ||
    !sameStrings(
      reviewOutcome.candidateArtifactRefs,
      expectedCandidateArtifactRefs,
    )
  ) {
    throw new Error(
      "Structured reviewer outcome must name the exact current candidate Artifact closure.",
    );
  }
  if (!Array.isArray(reviewOutcome.findings)) {
    throw new Error("Structured reviewer outcome findings are required.");
  }
  if (
    reviewOutcome.outcome === "PASSED" &&
    reviewOutcome.findings.length !== 0
  ) {
    throw new Error("A passing structured reviewer outcome cannot contain findings.");
  }
  if (
    reviewOutcome.outcome === "CHANGES_REQUESTED" &&
    reviewOutcome.findings.length === 0
  ) {
    throw new Error(
      "A changes-requested structured reviewer outcome requires findings.",
    );
  }
  for (const finding of reviewOutcome.findings) {
    assertNonEmptyString(
      finding?.triggeringScenario,
      "Reviewer finding triggering scenario is required.",
    );
    assertNonEmptyString(
      finding?.ownerAssignmentId,
      "Reviewer finding owner Assignment is required.",
    );
    assertNonEmptyString(
      finding?.summary,
      "Reviewer finding summary is required.",
    );
    if (!dependencyIds.has(finding.ownerAssignmentId)) {
      throw new Error(
        `Reviewer finding owner ${finding.ownerAssignmentId} is outside the reviewed candidate closure.`,
      );
    }
  }
  return clone(reviewOutcome);
}

export function applyTaskReviewFindings(execution, review) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    throw new Error("Structured reviewer findings are required.");
  }
  assertNonEmptyString(
    review.reviewerAssignmentId,
    "Reviewer Assignment ID is required.",
  );
  const reviewerNode = execution.nodes.find(
    (node) => node.assignment.id === review.reviewerAssignmentId,
  );
  if (
    !reviewerNode ||
    reviewerNode.status !== "COMPLETED" ||
    reviewerNode.agent?.roleId !== "sol_reviewer" ||
    reviewerNode.agent?.effectivePermission !== "read-only" ||
    reviewerNode.agent?.independent !== true
  ) {
    throw new Error(
      "Reviewer findings require a completed independent read-only Sol Reviewer Assignment.",
    );
  }
  if (
    reviewerNode.reviewOutcome?.outcome !== "CHANGES_REQUESTED" ||
    !sameValue(reviewerNode.reviewOutcome.findings, review.findings)
  ) {
    throw new Error(
      "Reviewer findings must match the current structured reviewer outcome.",
    );
  }
  if (!Array.isArray(review.findings) || review.findings.length === 0) {
    throw new Error("Reviewer findings are required.");
  }

  const nodesById = new Map(
    execution.nodes.map((node) => [node.assignment.id, node]),
  );
  const reviewerPrerequisiteIds = new Set();
  const collectPrerequisites = (assignmentId) => {
    const node = nodesById.get(assignmentId);
    for (const dependency of node?.dependsOn ?? []) {
      if (!reviewerPrerequisiteIds.has(dependency)) {
        reviewerPrerequisiteIds.add(dependency);
        collectPrerequisites(dependency);
      }
    }
  };
  collectPrerequisites(review.reviewerAssignmentId);
  const affectedAssignmentIds = [];
  for (const finding of review.findings) {
    assertNonEmptyString(
      finding?.triggeringScenario,
      "Reviewer finding triggering scenario is required.",
    );
    assertNonEmptyString(
      finding?.ownerAssignmentId,
      "Reviewer finding owner Assignment is required.",
    );
    const owner = nodesById.get(finding.ownerAssignmentId);
    if (
      !owner ||
      owner.status !== "COMPLETED" ||
      owner.assignment.id === review.reviewerAssignmentId
    ) {
      throw new Error(
        `Reviewer finding owner ${finding.ownerAssignmentId} is not completed affected work.`,
      );
    }
    if (!reviewerPrerequisiteIds.has(finding.ownerAssignmentId)) {
      throw new Error(
        `Reviewer finding owner ${finding.ownerAssignmentId} must be a transitive prerequisite of the reviewer.`,
      );
    }
    if (!affectedAssignmentIds.includes(finding.ownerAssignmentId)) {
      affectedAssignmentIds.push(finding.ownerAssignmentId);
    }
  }

  const invalidatedAssignmentIds = new Set([
    ...affectedAssignmentIds,
    review.reviewerAssignmentId,
  ]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of execution.nodes) {
      if (
        !invalidatedAssignmentIds.has(node.assignment.id) &&
        node.dependsOn.some((dependency) =>
          invalidatedAssignmentIds.has(dependency),
        )
      ) {
        invalidatedAssignmentIds.add(node.assignment.id);
        changed = true;
      }
    }
  }

  const invalidatedArtifactRefs = [];
  const invalidatedEvidenceRefs = [];
  const next = clone(execution);
  next.nodes = next.nodes.map((node) => {
    if (!invalidatedAssignmentIds.has(node.assignment.id)) {
      return node;
    }
    invalidatedArtifactRefs.push(
      ...node.artifacts.map(artifactReference).filter(Boolean),
    );
    invalidatedEvidenceRefs.push(...node.evidenceRefs);
    const attempt = node.run
      ? {
          attempt: node.attempt,
          waveId: node.currentWaveId,
          status: node.status,
          run: clone(node.run),
          artifacts: clone(node.artifacts),
          evidenceRefs: clone(node.evidenceRefs),
        }
      : null;
    return {
      ...node,
      status: affectedAssignmentIds.includes(node.assignment.id)
        ? "CHANGES_REQUESTED"
        : "PENDING",
      agent: null,
      currentWaveId: null,
      run: null,
      artifacts: [],
      evidenceRefs: [],
      reviewOutcome: null,
      attempts: [
        ...(node.attempts ?? []),
        ...(attempt ? [attempt] : []),
      ],
    };
  });
  next.decisionRooms = next.decisionRooms.map((room) =>
    invalidatedAssignmentIds.has(room.assignmentId) &&
    ["OPEN", "RESOLVED"].includes(room.status)
      ? { ...room, status: "STALE" }
      : room,
  );

  return {
    execution: refreshTaskExecution(next),
    affectedAssignmentIds,
    invalidatedArtifactRefs: [...new Set(invalidatedArtifactRefs)],
    invalidatedEvidenceRefs: [...new Set(invalidatedEvidenceRefs)],
  };
}

export function projectTaskExecutionEvent(execution, event) {
  if (event.type === "EXECUTION_WAVE_DISPATCHED") {
    return projectWaveDispatch(execution, event);
  }
  if (event.type === "DECISION_ROOM_OPENED") {
    return projectDecisionRoomOpened(execution, event);
  }
  if (event.type === "DECISION_ROOM_RESOLVED") {
    return projectDecisionRoomResolved(execution, event);
  }
  if (event.type === "EXECUTION_ASSIGNMENT_RETRIED") {
    return projectExecutionRetry(execution, event);
  }
  return projectRunObservation(execution, event);
}

export function createTaskExecution(
  taskGraph,
  { requireIndependentReview = false } = {},
) {
  assertTaskGraph(taskGraph, { requireIndependentReview });
  const reservedSlots = taskGraph.coordinationRequired ? 1 : 0;
  const execution = {
    capacity: taskGraph.capacity,
    coordinationRequired: taskGraph.coordinationRequired,
    reservedSlots,
    workerCapacity: taskGraph.capacity - reservedSlots,
    availableWorkerSlots: taskGraph.capacity - reservedSlots,
    nodes: taskGraph.assignments.map((graphAssignment) => {
      const {
        dependsOn,
        requiresDecision = false,
        ...assignment
      } = clone(graphAssignment);
      return {
        assignment,
        dependsOn,
        requiresDecision,
        status: "PENDING",
        attempt: 0,
        currentWaveId: null,
        agent: null,
        run: null,
        artifacts: [],
        evidenceRefs: [],
        reviewOutcome: null,
        attempts: [],
      };
    }),
    frontier: [],
    activeAssignmentIds: [],
    waves: [],
    decisionRooms: [],
  };
  return refreshTaskExecution(execution);
}

export function taskExecutionAllowedActions(execution) {
  const actions = [];
  const openDecisionAssignments = new Set(
    execution.decisionRooms
      .filter((room) => room.status === "OPEN")
      .map((room) => room.assignmentId),
  );
  if (
    execution.decisionRequiredAssignmentIds.some(
      (assignmentId) => !openDecisionAssignments.has(assignmentId),
    )
  ) {
    actions.push("open_decision_room");
  }
  if (openDecisionAssignments.size > 0) {
    actions.push("resolve_decision_room");
  }
  if (execution.frontier.length > 0 && execution.availableWorkerSlots > 0) {
    actions.push("dispatch_execution_wave");
  }
  if (
    execution.nodes.some((node) => ["BLOCKED", "ERROR"].includes(node.status))
  ) {
    actions.push("retry_execution_assignment");
  }
  return actions;
}
