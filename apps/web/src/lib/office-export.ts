import type { ArtifactRef } from "@starter/office-contract";

/**
 * Browser-side doc export policy: media identity, honest failure phases and a bounded local
 * filename. Download bytes stay on the existing authenticated same-origin artifact route.
 */
export type OfficeExportFormat = "docx" | "txt";
const officeExportMediaType: Record<OfficeExportFormat, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
};
/** Phases that prove nothing was submitted, so a new export is safe. */
export const officeExportFailedPhases = new Set([
  "failed-before-submit",
  "cancelled-before-dispatch",
  "conflict",
]);
/** The confirmed export artifact must carry the requested format's exact media identity. */
export const isOfficeExportArtifact = (
  artifact: ArtifactRef | null,
  format: OfficeExportFormat,
): artifact is ArtifactRef =>
  artifact !== null &&
  artifact.kind === "export" &&
  artifact.mediaType === officeExportMediaType[format];
const displaySuffix = /\s+·\s+(?:Main|draft|ready|merging|merged|discarded)\s*$/i;
/** The receipt carries no filename; derive one bounded name from the shown title. */
export function officeExportFilename(title: string, format: OfficeExportFormat): string {
  const base = Array.from(title, (char) => (char.charCodeAt(0) < 32 ? " " : char))
    .join("")
    .replace(displaySuffix, "")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\.(?:docx?|txt)$/i, "")
    .slice(0, 80);
  return `${base === "" ? "document" : base}.${format}`;
}
/** A blocked automatic download remains available through the persistent link. No blob copy. */
export function startOfficeExportDownload(artifactId: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = `/api/office/artifacts/${encodeURIComponent(artifactId)}/bytes`;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}
