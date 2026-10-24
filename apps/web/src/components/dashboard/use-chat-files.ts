/**
 * Public staged-file owner. Upload, acceptance and discard are scoped to the
 * exact frozen IDs, so a later draft can neither be uploaded nor cleared by an
 * older operation. Aggregate byte budgets and preview reservations live in the
 * staging hook.
 */
import { useCallback, useRef } from "react";
import { deleteChatAttachment } from "@/lib/chat-capability-api";
import { MAX_MESSAGE_ATTACHMENT_BYTES } from "@/lib/chat-capability-file-types";
import { formatFileSize, type LocalFile } from "@/lib/chat-file-local";
import type { ChatFilesControls, UploadOutcome } from "@/lib/chat-store-context";
import { uploadStagedFiles } from "./chat-file-uploads";
import { useChatFileStaging } from "./use-chat-file-staging";

function rowReason(files: readonly LocalFile[]): string | null {
  if (files.some((file) => file.state === "preparing" || file.state === "uploading"))
    return "Wait for the added files to finish preparing.";
  const rejected = files.find((file) => file.state === "unsupported" || file.state === "failed");
  if (rejected) return `Remove "${rejected.name}" and attach it again before sending.`;
  const bytes = files.reduce((sum, file) => sum + file.byteSize, 0);
  if (bytes > MAX_MESSAGE_ATTACHMENT_BYTES)
    return `Files for one message can total at most ${formatFileSize(MAX_MESSAGE_ATTACHMENT_BYTES)}.`;
  return null;
}

export function useChatFiles(chatId: string | null): Omit<
  ChatFilesControls,
  "ensureUploaded" | "commit" | "discard"
> & {
  ensureUploaded: (targetChatId: string, ids: readonly string[]) => Promise<UploadOutcome>;
  commit: (targetChatId: string, ids: readonly string[]) => void;
  discard: (targetChatId: string, ids: readonly string[]) => void;
} {
  const staging = useChatFileStaging(chatId);
  const uploadingRef = useRef(new Set<string>());
  const { applyRows, releaseRow, replace, rowsRef } = staging;

  /** Uploads only the exact frozen IDs, in frozen order. */
  const ensureUploaded = async (
    targetChatId: string,
    ids: readonly string[],
  ): Promise<UploadOutcome> => {
    if (uploadingRef.current.has(targetChatId))
      return { ok: false, error: "An upload for this chat is already in progress." };
    uploadingRef.current.add(targetChatId);
    try {
      const rows = rowsRef.current[targetChatId] ?? [];
      const frozen: LocalFile[] = [];
      for (const id of ids) {
        const row = rows.find((item) => item.id === id);
        if (!row)
          return {
            ok: false,
            error: "A file for this send is no longer staged. Discard and try again.",
          };
        frozen.push(row);
      }
      return await uploadStagedFiles(targetChatId, frozen, (id, next) =>
        replace(targetChatId, id, next),
      );
    } finally {
      uploadingRef.current.delete(targetChatId);
    }
  };

  /** Removes and releases only the accepted operation's rows; other drafts stay. */
  const commit = useCallback(
    (targetChatId: string, ids: readonly string[]) => {
      const rows = rowsRef.current[targetChatId] ?? [];
      const accepted = rows.filter((row) => ids.includes(row.id));
      if (accepted.length === 0) return;
      for (const row of accepted) releaseRow(row);
      applyRows(
        targetChatId,
        rows.filter((row) => !ids.includes(row.id)),
      );
    },
    [applyRows, releaseRow, rowsRef],
  );

  /** Discard releases the frozen rows and best-effort deletes their uploads. */
  const discard = useCallback(
    (targetChatId: string, ids: readonly string[]) => {
      for (const row of rowsRef.current[targetChatId] ?? []) {
        if (ids.includes(row.id) && row.descriptor)
          void deleteChatAttachment(targetChatId, row.id).catch(() => undefined);
      }
      commit(targetChatId, ids);
    },
    [commit, rowsRef],
  );

  return {
    files: staging.files,
    notice: staging.notice,
    blockedReason: rowReason(staging.files),
    add: staging.add,
    remove: staging.remove,
    retry: staging.retry,
    clearNotice: staging.clearNotice,
    ensureUploaded,
    commit,
    discard,
  };
}
