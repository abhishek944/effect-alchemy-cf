import type { ReferenceSource } from "./reference-types";
import type { WorkspacePreviewTab } from "./workspace-preview-model";

/** Resolve only a registered, loaded source. */
export function workspaceReferenceSource(
  tab: WorkspacePreviewTab,
  sources: readonly ReferenceSource[],
) {
  if (tab.kind !== "image" && tab.kind !== "text") return null;
  return (
    sources.find((source) => source.kind === "original" && source.file.id === tab.file.id) ?? null
  );
}
