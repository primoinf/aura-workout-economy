const REFERENCE_FIELDS = ["uri", "path", "ref", "id"];
const DETAIL_FIELDS = ["diff", "patch", "content"];
const NON_CONTENT_FIELDS = new Set([
  ...REFERENCE_FIELDS,
  "name",
  "summary",
  "mimeType",
  "mediaType",
  "encoding",
  "sha256",
  "checksum",
  "size",
  "length",
]);

function isInspectableDetail(value) {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (
      trimmed !== "" &&
      !/^[a-z][a-z\d+.-]*:/i.test(trimmed) &&
      !/^(?:[a-z]:[\\/]|[\\/]|\.{1,2}[\\/])/i.test(trimmed) &&
      !(!/\s/.test(trimmed) && /[\\/]/.test(trimmed))
    );
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  return Object.entries(value)
    .filter(([key]) => !NON_CONTENT_FIELDS.has(key))
    .some(([, child]) =>
      typeof child === "object" && child !== null
        ? isInspectableDetail(child)
        : child !== undefined && child !== null && isInspectableDetail(String(child)),
    );
}

export function artifactReference(artifact) {
  return (
    REFERENCE_FIELDS
      .map((field) => artifact?.[field])
      .find((value) => typeof value === "string" && value.trim() !== "") ??
    null
  );
}

export function firstInspectableArtifactDetail(
  artifact,
  fields = DETAIL_FIELDS,
) {
  return (
    fields
      .map((field) => artifact?.[field])
      .find(isInspectableDetail) ?? null
  );
}

export function artifactHasInspectableDetail(artifact) {
  return Boolean(firstInspectableArtifactDetail(artifact));
}
