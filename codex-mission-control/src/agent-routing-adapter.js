const ROLE_ROUTES = Object.freeze([
  Object.freeze({
    roleId: "luna_worker",
    roleName: "Luna Worker",
    capability: "deterministic",
    workKinds: Object.freeze(["deterministic"]),
    risks: Object.freeze(["low", "medium"]),
    maximumPermission: "workspace-write",
  }),
  Object.freeze({
    roleId: "terra_builder",
    roleName: "Terra Builder",
    capability: "implementation",
    workKinds: Object.freeze(["implementation"]),
    risks: Object.freeze(["low", "medium"]),
    maximumPermission: "workspace-write",
  }),
  Object.freeze({
    roleId: "terra_debugger",
    roleName: "Terra Debugger",
    capability: "debugging",
    workKinds: Object.freeze(["debugging"]),
    risks: Object.freeze(["medium", "high"]),
    maximumPermission: "workspace-write",
  }),
  Object.freeze({
    roleId: "sol_architect",
    roleName: "Sol Architect",
    capability: "architecture",
    workKinds: Object.freeze([
      "architecture",
      "deterministic",
      "implementation",
      "debugging",
    ]),
    risks: Object.freeze(["high", "critical"]),
    maximumPermission: "read-only",
  }),
  Object.freeze({
    roleId: "sol_reviewer",
    roleName: "Sol Reviewer",
    capability: "review",
    workKinds: Object.freeze(["review"]),
    risks: Object.freeze(["low", "medium", "high", "critical"]),
    maximumPermission: "read-only",
  }),
]);

function clone(value) {
  return structuredClone(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}

function assertNonEmptyString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`Assignment ${field} is required.`);
  }
}

function assertNonEmptyStringArray(value, field) {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new Error(
      `Assignment ${field} must contain at least one item.`,
    );
  }
}

function assertPathArray(value, field) {
  if (
    !Array.isArray(value) ||
    value.some((path) => typeof path !== "string" || path.trim() === "")
  ) {
    throw new Error(`Assignment ownershipBoundary ${field} is invalid.`);
  }
  if (
    value.some((path) => {
      const normalized = path.trim().replaceAll("\\", "/");
      return (
        normalized === "." ||
        normalized.startsWith("/") ||
        /^[a-z]:\//i.test(normalized) ||
        normalized.split("/").includes("..")
      );
    })
  ) {
    throw new Error(
      `Assignment ownershipBoundary ${field} must use bounded relative paths.`,
    );
  }
}

function assertValidAssignment(assignment) {
  if (!assignment || typeof assignment !== "object") {
    throw new Error("A bounded Assignment is required.");
  }

  for (const field of [
    "id",
    "goal",
    "effectivePermission",
    "workKind",
    "risk",
  ]) {
    assertNonEmptyString(assignment[field], field);
  }
  assertNonEmptyStringArray(
    assignment.acceptanceCriteria,
    "acceptanceCriteria",
  );
  assertNonEmptyStringArray(assignment.expectedEvidence, "expectedEvidence");

  if (
    !assignment.contextSlice ||
    typeof assignment.contextSlice !== "object"
  ) {
    throw new Error("Assignment contextSlice is required.");
  }
  assertNonEmptyString(assignment.contextSlice.summary, "contextSlice summary");
  assertNonEmptyStringArray(
    assignment.contextSlice.sourceRefs,
    "contextSlice sourceRefs",
  );

  if (
    !assignment.ownershipBoundary ||
    typeof assignment.ownershipBoundary !== "object"
  ) {
    throw new Error("Assignment ownershipBoundary is required.");
  }
  const { readPaths, writePaths } = assignment.ownershipBoundary;
  assertPathArray(readPaths, "readPaths");
  assertPathArray(writePaths, "writePaths");
  if (readPaths.length === 0 && writePaths.length === 0) {
    throw new Error("Assignment ownershipBoundary cannot be empty.");
  }
  if (
    assignment.effectivePermission === "read-only" &&
    writePaths.length > 0
  ) {
    throw new Error(
      "A read-only Assignment cannot declare writable ownership.",
    );
  }
  if (
    !["read-only", "workspace-write"].includes(
      assignment.effectivePermission,
    )
  ) {
    throw new Error("Assignment effectivePermission is unsupported.");
  }
  if (
    assignment.effectivePermission === "workspace-write" &&
    writePaths.length === 0
  ) {
    throw new Error(
      "A workspace-write Assignment requires writable ownership.",
    );
  }

  if (!assignment.budget || typeof assignment.budget !== "object") {
    throw new Error("Assignment budget is required.");
  }
  for (const field of ["maxTurns", "maxMinutes"]) {
    if (
      !Number.isInteger(assignment.budget[field]) ||
      assignment.budget[field] < 1
    ) {
      throw new Error(
        `Assignment budget ${field} must be a positive integer.`,
      );
    }
  }
}

function assertTransportEnvelope(message) {
  if (!message || typeof message !== "object") {
    throw new Error("Agent transport emitted an invalid observation.");
  }
  assertNonEmptyString(message.runId, "Run ID");
  if (
    typeof message.occurredAt !== "string" ||
    Number.isNaN(Date.parse(message.occurredAt))
  ) {
    throw new Error("Agent transport observation timestamp is invalid.");
  }
}

function assertArtifact(artifact) {
  if (!artifact || typeof artifact !== "object") {
    throw new Error("Completed Run Artifact is invalid.");
  }
  assertNonEmptyString(artifact.name, "Artifact name");
  assertNonEmptyString(artifact.uri, "Artifact URI");
}

function assertEvidence(evidence) {
  if (!evidence || typeof evidence !== "object") {
    throw new Error("Completed Run Evidence is invalid.");
  }
  assertNonEmptyString(evidence.ref, "Evidence reference");
  assertNonEmptyString(evidence.kind, "Evidence kind");
  assertNonEmptyString(evidence.summary, "Evidence summary");
}

function normalizeTransportObservation(message) {
  assertTransportEnvelope(message);

  if (message.kind === "started") {
    return {
      type: "RUN_STARTED",
      runId: message.runId,
      status: "WORKING",
      occurredAt: message.occurredAt,
      ...(message.model ? { modelMetadata: clone(message.model) } : {}),
    };
  }
  if (message.kind === "progress") {
    assertNonEmptyString(message.summary, "Run progress summary");
    return {
      type: "RUN_UPDATED",
      runId: message.runId,
      status: "WORKING",
      occurredAt: message.occurredAt,
      summary: message.summary,
    };
  }
  if (message.kind === "completed") {
    assertNonEmptyString(message.summary, "Run completion summary");
    if (!Array.isArray(message.artifacts) || message.artifacts.length === 0) {
      throw new Error(
        "Completed Run requires at least one structured Artifact.",
      );
    }
    if (!Array.isArray(message.evidence) || message.evidence.length === 0) {
      throw new Error(
        "Completed Run requires at least one structured Evidence item.",
      );
    }
    message.artifacts.forEach(assertArtifact);
    message.evidence.forEach(assertEvidence);
    return {
      type: "RUN_COMPLETED",
      runId: message.runId,
      status: "COMPLETED",
      occurredAt: message.occurredAt,
      summary: message.summary,
      artifacts: clone(message.artifacts),
      evidence: clone(message.evidence),
    };
  }
  if (message.kind === "blocked") {
    assertNonEmptyString(message.blocker, "Run blocker");
    assertNonEmptyStringArray(
      message.attemptedAlternatives,
      "Run attemptedAlternatives",
    );
    assertNonEmptyString(
      message.requiredAuthorityOrInput,
      "Run requiredAuthorityOrInput",
    );
    return {
      type: "RUN_BLOCKED",
      runId: message.runId,
      status: "BLOCKED",
      occurredAt: message.occurredAt,
      blocker: message.blocker,
      attemptedAlternatives: clone(message.attemptedAlternatives),
      requiredAuthorityOrInput: message.requiredAuthorityOrInput,
    };
  }

  throw new Error(`Unknown agent transport observation: ${message.kind}.`);
}

export function createAgentRoutingAdapter({ transport }) {
  if (!transport || typeof transport.run !== "function") {
    throw new Error("An agent transport with run() is required.");
  }

  return {
    route(assignment) {
      assertValidAssignment(assignment);
      const role = ROLE_ROUTES.find(
        (candidate) =>
          candidate.workKinds.includes(assignment.workKind) &&
          candidate.risks.includes(assignment.risk),
      );
      if (!role) {
        throw new Error(
          `No configured role can accept ${assignment.workKind} work at ${assignment.risk} risk.`,
        );
      }

      const effectivePermission =
        role.maximumPermission === "read-only"
          ? "read-only"
          : assignment.effectivePermission;
      const boundedAssignment = clone(assignment);
      boundedAssignment.effectivePermission = effectivePermission;
      if (effectivePermission === "read-only") {
        boundedAssignment.ownershipBoundary.readPaths = [
          ...new Set([
            ...boundedAssignment.ownershipBoundary.readPaths,
            ...boundedAssignment.ownershipBoundary.writePaths,
          ]),
        ];
        boundedAssignment.ownershipBoundary.writePaths = [];
      }

      return deepFreeze({
        assignment: boundedAssignment,
        agent: {
          roleId: role.roleId,
          roleName: role.roleName,
          capability: role.capability,
          effectivePermission,
        },
      });
    },
    async *run(routing) {
      if (
        !routing ||
        typeof routing !== "object" ||
        !routing.assignment ||
        !routing.agent
      ) {
        throw new Error("A routed Assignment is required.");
      }

      const stream = transport.run({
        roleId: routing.agent.roleId,
        permission: routing.agent.effectivePermission,
        assignment: clone(routing.assignment),
      });
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function") {
        throw new Error("Agent transport run() must return an async iterable.");
      }
      for await (const message of stream) {
        yield deepFreeze(normalizeTransportObservation(message));
      }
    },
  };
}
