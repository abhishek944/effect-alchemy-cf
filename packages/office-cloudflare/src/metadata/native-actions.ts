import type { NativeReceiptKey, NativeWriteRecord } from "@starter/office-server/ports";
import { invalid } from "./store.ts";
/** Provider-private action mapping. No caller-controlled action or generic receipt lookup is exported by the application port. */
export function nativeReceiptAction(key: NativeReceiptKey): string {
  switch (key.kind) {
    case "create-main":
      return "create-main";
    case "snapshot":
      return `snapshot:${key.revision}`;
    case "main-change":
      return `main-change:${key.revision}`;
    case "create-worktree":
      return `create-worktree:${key.worktreeId}`;
    case "add-unit":
      return `add-unit:${key.worktreeId}`;
    case "create-draft":
      return `create-draft:${key.worktreeId}`;
    case "merge-artifact":
      return `artifact:${key.worktreeId}:${key.readyRevision}`;
    case "merge-result":
      return `merge-result:${key.worktreeId}:${key.readyRevision}`;
    case "draft-change":
      return `draft-change:${key.worktreeId}:${key.revision}`;
    case "transition":
      return `transition:${key.worktreeId}:${key.generation}:${key.target}`;
    case "set-removed":
      return `removed:${key.worktreeId}:${key.generation}:${Number(key.removed)}`;
  }
  throw invalid();
}
export function contentRevision(write: NativeWriteRecord): number | null {
  const key = write.receiptKey;
  if (write.kind === "create-unit" && (key.kind === "create-main" || key.kind === "create-draft"))
    return 1;
  if (write.kind === "changeset" && (key.kind === "main-change" || key.kind === "draft-change")) {
    if (write.baseRevision === null || key.revision !== write.baseRevision + 1) throw invalid();
    return key.revision;
  }
  if (write.kind === "snapshot" && key.kind === "snapshot") return key.revision;
  if (
    write.kind === "lifecycle" &&
    !["create-main", "create-draft", "main-change", "draft-change", "snapshot"].includes(key.kind)
  )
    return null;
  throw invalid();
}
