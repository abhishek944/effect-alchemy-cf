import { useEffect, useState } from "react";
import { getSavedFile } from "@/lib/chat-library-api";
import { errorMessage } from "@/lib/chat-api";
import type { TabDescriptor } from "./workspace-session";
import type { WorkspacePreviewTab } from "./workspace-preview-model";
import { useWorkspacePreview } from "./workspace-preview-context";

type RestoringTab = Extract<WorkspacePreviewTab, { kind: "restoring" }>;
async function hydrate(
  chatId: string,
  descriptor: TabDescriptor,
  signal: AbortSignal,
): Promise<WorkspacePreviewTab> {
  if (descriptor.kind !== "image" && descriptor.kind !== "text")
    return { id: descriptor.id, kind: descriptor.kind };
  const file = await getSavedFile(chatId, descriptor.fileId, signal);
  if (file.kind !== descriptor.kind) throw new Error("The saved file kind changed.");
  return { id: descriptor.id, kind: descriptor.kind, file };
}

/**
 * One retained saved placeholder. Hydration is bound to its origin chat and tab: changing the
 * visible chat no longer aborts an already-authorized read, and only a real tab close or account
 * teardown stops it. Reads use fresh server authorization.
 */
export function WorkspacePreviewRestore({ tab, chatId }: { tab: RestoringTab; chatId: string }) {
  const { restoreTab } = useWorkspacePreview();
  const [attempt, retry] = useState(0);
  const [failure, setFailure] = useState<{ attempt: number; message: string } | null>(null);
  const error = failure?.attempt === attempt ? failure.message : "";
  useEffect(() => {
    const active = new AbortController();
    const run = async () => {
      // Start asynchronously so the effect body never sets state synchronously.
      await Promise.resolve();
      if (active.signal.aborted) return;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]);
      try {
        const result = await hydrate(chatId, tab.descriptor, signal);
        if (active.signal.aborted) return;
        restoreTab(chatId, tab, result);
      } catch (cause) {
        if (!active.signal.aborted) setFailure({ attempt, message: errorMessage(cause) });
      }
    };
    void run();
    return () => {
      active.abort();
    };
  }, [attempt, chatId, restoreTab, tab]);
  if (!error)
    return (
      <section data-cx="workspace-opening" aria-label="Restore saved tab">
        <output>Opening…</output>
      </section>
    );
  return (
    <section data-cx="workspace-opening" aria-label="Restore saved tab">
      <p role="alert">{error}</p>
      <button type="button" onClick={() => retry((value) => value + 1)}>
        Retry authorized read
      </button>
    </section>
  );
}
