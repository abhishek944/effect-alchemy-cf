import type { ReferenceSource } from "./reference-types";
import type { WorkspacePreviewTab } from "./workspace-preview-model";

/** Resolve only a registered, loaded source. Native tabs never fall back to original bytes. */
export function workspaceReferenceSource(
  tab: WorkspacePreviewTab,
  sources: readonly ReferenceSource[],
) {
  if (tab.kind === "tools" || tab.kind === "files" || tab.kind === "restoring") return null;
  const selection =
    tab.kind === "office" ? tab.selection : tab.kind === "office-file" ? tab.resolved : null;
  if (selection !== null) {
    if (selection.reviewId !== null) return null;
    const scope = selection.target.scope;
    return (
      sources.find(
        (source) =>
          source.kind === "native" &&
          source.target.documentId === selection.target.documentId &&
          source.target.kind === scope.kind &&
          (scope.kind === "main" ||
            (source.target.kind === "draft" &&
              source.target.draftId === scope.draftId &&
              source.target.generation === scope.generation)),
      ) ?? null
    );
  }
  if (!("file" in tab)) return null;
  return (
    sources.find((source) => source.kind === "original" && source.file.id === tab.file.id) ?? null
  );
}
