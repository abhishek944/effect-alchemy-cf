import { useLayoutEffect, useRef } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import type { ChatCatalogEntry } from "@/lib/chat-capability-types";
import type { LocalFile } from "@/lib/chat-file-local";
import type { ChatReferences } from "./use-chat-references";
import { inputFilesReason } from "./chat-input-files-policy";
import { useReferenceWorkspace } from "./reference-workspace";
import { originalReferenceKey } from "./reference-types";

/** Compatibility actions for existing file-card callers; identities now live only in atomic nodes. */
export function useChatReferenceDrafts(options: {
  chatId: string | null;
  scope: string;
  active: boolean;
  archived: boolean;
  lockedIds: readonly string[];
  staged: readonly LocalFile[];
  model: ChatCatalogEntry | null;
  reportError: (message: string | null) => void;
}) {
  const workspace = useReferenceWorkspace();
  const latest = useRef(options);
  useLayoutEffect(() => {
    latest.current = options;
  }, [options]);
  const references: ChatReferences = {
    files: [],
    ids: [],
    add(file: SavedFile) {
      const current = latest.current;
      if (
        !current.active ||
        current.archived ||
        file.chatId !== current.chatId ||
        file.state !== "ready"
      )
        return false;
      const reason = inputFilesReason([...current.staged, file], current.model);
      if (reason) {
        current.reportError(reason);
        return false;
      }
      const source = workspace.source(file.chatId, originalReferenceKey(file.id)) ?? {
        kind: "original" as const,
        file,
        chatId: file.chatId,
        key: originalReferenceKey(file.id),
        name: file.name,
        reveal: async () => {
          throw new Error("Open the saved original to view it.");
        },
      };
      // Capture the origin reporter before the await; later option updates must not re-address it.
      const report = current.reportError;
      void workspace
        .add(source)
        .catch((error: unknown) =>
          report(error instanceof Error ? error.message : "Reference unavailable."),
        );
      return true;
    },
    // Removal/Undo belongs to Lexical; no invisible parallel saved-file draft remains.
    remove: () => undefined,
    retry: async () => undefined,
    readFor: (file) => ({
      state: file.state === "ready" ? "ready" : "error",
      error: file.state === "ready" ? null : "Original unavailable",
    }),
    markUnavailable: (_id, error) => latest.current.reportError(error ?? "Original unavailable"),
    blockedReason: inputFilesReason(options.staged, options.model),
  };
  return { references, commit: (_chatId: string, _ids: readonly string[]) => undefined };
}
