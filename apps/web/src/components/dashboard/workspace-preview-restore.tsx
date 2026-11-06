import { useEffect, useState } from "react";
import type { OfficeRuntime } from "@highchat/office-react";
import { getSavedFile, savedOriginalUrl } from "@/lib/chat-library-api";
import { errorMessage } from "@/lib/chat-api";
import { observeOfficeOriginal } from "@/lib/office-original";
import type { SavedFile } from "@/lib/chat-library-types";
import type { TabDescriptor } from "./workspace-session";
import type { WorkspacePreviewTab } from "./workspace-preview-model";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useWorkspacePreview } from "./workspace-preview-context";

type RestoringTab = Extract<WorkspacePreviewTab, { kind: "restoring" }>;
async function hydrate(
  runtime: OfficeRuntime,
  chatId: string,
  descriptor: TabDescriptor,
  signal: AbortSignal,
): Promise<WorkspacePreviewTab | SavedFile> {
  if (descriptor.kind === "tools" || descriptor.kind === "files") return descriptor;
  if ("fileId" in descriptor) {
    const file = await getSavedFile(chatId, descriptor.fileId, signal);
    if (descriptor.kind === "office-file") return file; // Observation-only, not an explicit import.
    if (file.kind !== descriptor.kind) throw new Error("The saved file kind changed.");
    return { id: descriptor.id, kind: descriptor.kind, file };
  }
  if (descriptor.kind !== "office") throw new Error("Saved tab descriptor is unavailable.");
  const { target, reviewId } = descriptor;
  const document = await runtime.run(
    runtime.client.office.document({
      params: { documentId: target.documentId },
    }),
    { signal },
  );
  if (document.id !== target.documentId) throw new Error("The document identity changed.");
  if (reviewId !== null) {
    const review = await runtime.run(
      runtime.client.office.review({ params: { reviewId }, query: {} }),
      { signal },
    );
    if (review.reviewId !== reviewId || review.documentId !== target.documentId)
      throw new Error("The saved review is unavailable.");
  } else if (target.scope.kind === "draft") {
    const scope = target.scope;
    const draft = await runtime.run(
      runtime.client.office.draft({ params: { draftId: scope.draftId } }),
      { signal },
    );
    if (
      draft.id !== scope.draftId ||
      draft.documentId !== target.documentId ||
      draft.generation !== scope.generation ||
      draft.status !== "draft"
    )
      throw new Error(
        "The exact draft generation changed or is no longer editable. Choose it in Files.",
      );
  }
  return {
    id: descriptor.id,
    kind: "office",
    attachments: descriptor.attachments,
    selection: { title: document.title, target, reviewId, attachments: descriptor.attachments },
  };
}

/**
 * One retained saved placeholder. Hydration is bound to its origin chat and tab: changing the
 * visible chat no longer aborts an already-authorized read, and only a real tab close, account
 * teardown stops it. Reads use fresh server authorization;
 * unresolved originals never replay imports.
 */
export function WorkspacePreviewRestore({ tab, chatId }: { tab: RestoringTab; chatId: string }) {
  const { runtime } = useWorkspaceOffice();
  const { restoreTab } = useWorkspacePreview();
  const [attempt, retry] = useState(0);
  const [file, setFile] = useState<SavedFile | null>(null);
  const [failure, setFailure] = useState<{ attempt: number; message: string } | null>(null);
  const [observation, setObservation] = useState("");
  const [checking, setChecking] = useState(false);
  const error = failure?.attempt === attempt ? failure.message : "";
  useEffect(() => {
    const active = new AbortController();
    const run = async () => {
      // Start asynchronously so the effect body never sets state synchronously.
      await Promise.resolve();
      if (active.signal.aborted) return;
      const signal = AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]);
      try {
        const resolved = await runtime;
        const result = await hydrate(resolved, chatId, tab.descriptor, signal);
        if (active.signal.aborted) return;
        if ("byteSize" in result) setFile(result);
        else restoreTab(chatId, tab, result);
      } catch (cause) {
        if (!active.signal.aborted) setFailure({ attempt, message: errorMessage(cause) });
      }
    };
    void run();
    return () => {
      active.abort();
    };
  }, [attempt, chatId, restoreTab, runtime, tab]);
  const check = async () => {
    if (file === null || checking) return;
    setChecking(true);
    try {
      const result = await observeOfficeOriginal(await runtime, file, AbortSignal.timeout(30_000));
      setObservation(
        result.target !== null
          ? "A retained original target exists. Close this placeholder and open it explicitly from Files."
          : result.receipt === null
            ? "No original import operation was found. Nothing was started."
            : `Original import: ${result.receipt.phase}. No import or continuation was submitted.`,
      );
    } catch (cause) {
      setFailure({ attempt, message: errorMessage(cause) });
    } finally {
      setChecking(false);
    }
  };
  if (file === null && !error)
    return (
      <section data-cx="office-opening" aria-label="Restore saved tab">
        <output>Opening…</output>
      </section>
    );
  return (
    <section data-cx="office-opening" aria-label="Restore saved tab">
      <div>
        {file !== null && <p>Saved original: {file.name}</p>}
        {error && <p role="alert">{error}</p>}
        {error && (
          <button type="button" onClick={() => retry((value) => value + 1)}>
            Retry authorized read
          </button>
        )}
        {file !== null && (
          <>
            <p>Import state is observation-only after refresh. No native operation was replayed.</p>
            <button type="button" disabled={checking} onClick={() => void check()}>
              Check original operation
            </button>
            <a href={savedOriginalUrl(file)} download={file.name}>
              Download original
            </a>
            {observation && <output>{observation}</output>}
          </>
        )}
      </div>
    </section>
  );
}
