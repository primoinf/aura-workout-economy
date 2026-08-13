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
    throw new Error(`Assignment ${field} must contain at least one item.`);
  }
}

export function canonicalOwnershipPath(path) {
  if (typeof path !== "string" || path.trim() === "") {
    throw new Error("Ownership path is required.");
  }
  const segments = path.split("/");
  if (
    path !== path.trim() ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-z]:\//i.test(path) ||
    segments.some(
      (segment) => segment === "" || segment === "." || segment === "..",
    )
  ) {
    throw new Error(
      "Ownership path must use bounded relative paths (canonical bounded relative paths only).",
    );
  }
  return path.toLowerCase();
}

function assertPathArray(value, field) {
  if (
    !Array.isArray(value) ||
    value.some((path) => typeof path !== "string" || path.trim() === "")
  ) {
    throw new Error(`Assignment ownershipBoundary ${field} is invalid.`);
  }
  try {
    value.forEach(canonicalOwnershipPath);
  } catch {
    throw new Error(
      `Assignment ownershipBoundary ${field} must use bounded relative paths (canonical bounded relative paths only).`,
    );
  }
}

export function assertValidAgentAssignment(assignment) {
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
