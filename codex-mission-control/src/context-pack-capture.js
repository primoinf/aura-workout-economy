const REQUIRED_SOURCE_KINDS = Object.freeze([
  "workspace-rules",
  "repository-state",
  "recent-context",
  "task-status",
  "decisions",
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

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

function assertSource(source) {
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    !isNonEmptyString(source.kind) ||
    !isNonEmptyString(source.ref) ||
    !["available", "unavailable"].includes(source.status)
  ) {
    throw new Error(
      "Context capture sources require kind, reference, and availability status.",
    );
  }
}

function assertStatements(statements, field, availableRefs) {
  if (!Array.isArray(statements)) {
    throw new Error(`Context capture ${field} must be an array.`);
  }
  for (const statement of statements) {
    if (
      !statement ||
      typeof statement !== "object" ||
      Array.isArray(statement) ||
      !isNonEmptyString(statement.statement) ||
      !Array.isArray(statement.sourceRefs) ||
      statement.sourceRefs.length === 0 ||
      statement.sourceRefs.some(
        (reference) =>
          !isNonEmptyString(reference) || !availableRefs.has(reference),
      )
    ) {
      throw new Error(
        `Context capture ${field} require a statement and available source references.`,
      );
    }
  }
}

function normalizeCapture(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Context capture adapter returned an invalid snapshot.");
  }
  if (!isNonEmptyString(value.summary)) {
    throw new Error("Context capture summary is required.");
  }
  if (
    !isNonEmptyString(value.capturedAt) ||
    Number.isNaN(Date.parse(value.capturedAt))
  ) {
    throw new Error("Context capture timestamp is invalid.");
  }
  if (!Array.isArray(value.sources)) {
    throw new Error("Context capture sources are required.");
  }
  value.sources.forEach(assertSource);
  const sourceKinds = value.sources.map((source) => source.kind);
  if (new Set(sourceKinds).size !== sourceKinds.length) {
    throw new Error("Context capture source kinds must be unique.");
  }
  const unavailableSources = REQUIRED_SOURCE_KINDS.filter((kind) => {
    const source = value.sources.find((candidate) => candidate.kind === kind);
    return !source || source.status !== "available";
  });
  if (unavailableSources.length > 0) {
    return deepFreeze({
      connected: true,
      ready: false,
      context: null,
      unavailableSources,
    });
  }
  const availableRefs = new Set(
    value.sources
      .filter((source) => source.status === "available")
      .map((source) => source.ref),
  );
  assertStatements(value.facts, "facts", availableRefs);
  assertStatements(value.assumptions, "assumptions", availableRefs);
  if (value.facts.length === 0) {
    throw new Error("Context capture requires at least one source-backed fact.");
  }
  return deepFreeze({
    connected: true,
    ready: true,
    context: clone(value),
    unavailableSources: [],
  });
}

export function assertSourceBackedContextPack(
  value,
  { contextPackVersion } = {},
) {
  try {
    const capture = normalizeCapture(value);
    if (!capture.ready) {
      throw new Error(
        `required sources are unavailable: ${capture.unavailableSources.join(", ")}`,
      );
    }
    const context = clone(capture.context);
    if (contextPackVersion !== undefined) {
      if (!Number.isInteger(contextPackVersion) || contextPackVersion < 1) {
        throw new Error("Context Pack version must be a positive integer.");
      }
      context.contextPackVersion = contextPackVersion;
    }
    context.sourceRefs = context.sources
      .filter((source) => source.status === "available")
      .map((source) => source.ref);
    return deepFreeze(context);
  } catch (error) {
    throw new Error(`Source-backed Context Pack is invalid: ${error.message}`);
  }
}

export function createContextPackCapture(adapter) {
  if (!adapter || typeof adapter.capture !== "function") {
    return deepFreeze({
      connected: false,
      async capture() {
        return deepFreeze({
          connected: false,
          ready: false,
          context: null,
          unavailableSources: [...REQUIRED_SOURCE_KINDS],
        });
      },
    });
  }
  return deepFreeze({
    connected: true,
    async capture(input) {
      return normalizeCapture(await adapter.capture(clone(input)));
    },
  });
}
