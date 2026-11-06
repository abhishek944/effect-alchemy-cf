/**
 * Staging lifecycle for local files: preparation, removal and retry.
 * A superseded or unmounted preparation releases its resources instead of
 * leaking an object URL.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { createImageAttemptOwner } from "./chat-image-attempts";
import { prepareLocalFile, releaseLocalFile, type LocalFile } from "@/lib/chat-file-local";

function placeholder(file: File): LocalFile {
  return {
    id: crypto.randomUUID(),
    file,
    name: file.name,
    mediaType: "application/octet-stream",
    kind: "text",
    byteSize: file.size,
    state: "preparing",
    error: null,
    width: null,
    height: null,
    excerpt: null,
    previewUrl: null,
    descriptor: null,
  };
}

export type ChatFileStaging = {
  files: LocalFile[];
  notice: string | null;
  clearNotice: () => void;
  add: (incoming: File[]) => void;
  remove: (id: string) => void;
  retry: (id: string) => void;
  rowsRef: MutableRefObject<Record<string, LocalFile[]>>;
  applyRows: (targetChatId: string, rows: LocalFile[]) => void;
  replace: (targetChatId: string, id: string, next: (row: LocalFile) => LocalFile) => void;
  releaseRow: (row: LocalFile) => void;
};

export function useChatFileStaging(chatId: string | null): ChatFileStaging {
  const [byChat, setByChat] = useState<Record<string, LocalFile[]>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const rowsRef = useRef(byChat);
  const attempts = useMemo(() => createImageAttemptOwner(), []);

  const applyRows = useCallback((targetChatId: string, rows: LocalFile[]) => {
    rowsRef.current = { ...rowsRef.current, [targetChatId]: rows };
    setByChat(rowsRef.current);
  }, []);

  const releaseRow = useCallback(
    (row: LocalFile) => {
      // Pending completions are fenced before they can install a preview.
      attempts.releaseRow(row.id);
      releaseLocalFile(row);
    },
    [attempts],
  );

  const replace = useCallback(
    (targetChatId: string, id: string, next: (row: LocalFile) => LocalFile) => {
      const rows = rowsRef.current[targetChatId];
      const index = rows?.findIndex((row) => row.id === id) ?? -1;
      const row = rows?.[index];
      if (!rows || !row || index < 0) return;
      const copy = [...rows];
      copy[index] = next(row);
      applyRows(targetChatId, copy);
    },
    [applyRows],
  );

  useEffect(
    () => () => {
      // Fence in-flight attempts; each late completion revokes its own object URL.
      for (const rows of Object.values(rowsRef.current)) {
        for (const row of rows) releaseRow(row);
      }
    },
    [releaseRow],
  );

  const startPreparation = useCallback(
    (targetChatId: string, row: LocalFile) => {
      const lease = attempts.begin(row.id);
      const run = async () => {
        try {
          const next = await prepareLocalFile(row.file, row.id);
          const installed = rowsRef.current[targetChatId]?.some((item) => item.id === next.id);
          // Only the fenced attempt that still owns an installed row may land.
          if (!installed || !attempts.fenced(lease)) {
            attempts.discard(lease, next.previewUrl);
            return;
          }
          replace(targetChatId, next.id, () => next);
        } catch {
          const live = attempts.fenced(lease);
          attempts.discard(lease, null);
          if (live)
            replace(targetChatId, row.id, (current) => ({
              ...current,
              state: "failed",
              error: "Preparation failed.",
            }));
        }
      };
      void run();
    },
    [attempts, replace],
  );

  const add = useCallback(
    (incoming: File[]) => {
      if (!chatId || incoming.length === 0) return;
      setNotice(null);
      const prepared = incoming.map(placeholder);
      applyRows(chatId, [...(rowsRef.current[chatId] ?? []), ...prepared]);
      for (const row of prepared) startPreparation(chatId, row);
    },
    [applyRows, chatId, startPreparation],
  );

  const remove = useCallback(
    (id: string) => {
      if (!chatId) return;
      const targetChatId = chatId;
      const rows = rowsRef.current[targetChatId] ?? [];
      const target = rows.find((row) => row.id === id);
      if (!target) return;
      setNotice(null);
      releaseRow(target);
      applyRows(
        targetChatId,
        rows.filter((row) => row.id !== id),
      );
    },
    [applyRows, chatId, releaseRow],
  );

  const retry = useCallback(
    (id: string) => {
      if (!chatId) return;
      const targetChatId = chatId;
      const row = rowsRef.current[targetChatId]?.find((item) => item.id === id);
      if (!row) return;
      // A retry supersedes the previous attempt and its preview.
      releaseRow(row);
      const fresh: LocalFile = {
        ...row,
        state: "preparing",
        error: null,
        previewUrl: null,
      };
      replace(targetChatId, id, () => fresh);
      startPreparation(targetChatId, fresh);
    },
    [chatId, releaseRow, replace, startPreparation],
  );

  return {
    files: chatId ? (byChat[chatId] ?? []) : [],
    notice,
    clearNotice: () => setNotice(null),
    add,
    remove,
    retry,
    rowsRef,
    applyRows,
    replace,
    releaseRow,
  };
}
