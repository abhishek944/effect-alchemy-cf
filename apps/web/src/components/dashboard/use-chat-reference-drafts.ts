import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import type { ChatCatalogEntry } from "@/lib/chat-capability-types";
import type { LocalFile } from "@/lib/chat-file-local";
import { inputFilesReason } from "./chat-input-files-policy";
import { useChatReferences } from "./use-chat-references";

const EMPTY: readonly SavedFile[] = [];

/** The persistent account-scoped store owns reference drafts, never a keyed conversation. */
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
  const [rows, setRows] = useState<Readonly<Record<string, readonly SavedFile[]>>>({});
  const rowsRef = useRef(rows);
  const scope = useRef(options);
  useLayoutEffect(() => {
    scope.current = options;
  }, [options]);
  const files = options.chatId ? (rows[options.chatId] ?? EMPTY) : EMPTY;
  const replace = (next: readonly SavedFile[]) => {
    const current = scope.current;
    const chatId = options.chatId;
    if (!chatId || current.chatId !== chatId || !current.active) return;
    const baseline = new Set(files.map((file) => file.id));
    const requested = new Map(next.map((file) => [file.id, file]));
    const existing = rowsRef.current[chatId] ?? EMPTY;
    // Preserve concurrent later additions; a stale read cannot resurrect a committed ID.
    const merged = existing
      .filter((file) => !baseline.has(file.id) || requested.has(file.id))
      .map((file) => requested.get(file.id) ?? file);
    for (const file of next) {
      if (!baseline.has(file.id) && !merged.some((item) => item.id === file.id)) merged.push(file);
    }
    rowsRef.current = { ...rowsRef.current, [chatId]: merged };
    setRows(rowsRef.current);
  };
  const selected = useChatReferences({
    chatId: options.chatId ?? "",
    scope: options.scope,
    files,
    onChange: replace,
    archived: options.archived || !options.active,
    active: options.active,
    lockedIds: options.lockedIds,
  });
  const add = (file: SavedFile) => {
    const current = scope.current;
    if (!current.active || current.archived || file.chatId !== current.chatId) return false;
    const saved = rowsRef.current[file.chatId] ?? EMPTY;
    const candidate = saved.some((item) => item.id === file.id) ? saved : [...saved, file];
    const reason = inputFilesReason([...current.staged, ...candidate], current.model);
    if (reason) {
      current.reportError(reason);
      return false;
    }
    if (file.state !== "ready" || selected.readFor(file).state !== "ready") return false;
    if (!saved.some((item) => item.id === file.id)) {
      rowsRef.current = { ...rowsRef.current, [file.chatId]: [...saved, file] };
      setRows(rowsRef.current);
    }
    return true;
  };
  const commit = useCallback((chatId: string, ids: readonly string[]) => {
    const current = rowsRef.current[chatId] ?? EMPTY;
    const next = current.filter((file) => !ids.includes(file.id));
    if (next.length === current.length) return;
    rowsRef.current = { ...rowsRef.current, [chatId]: next };
    setRows(rowsRef.current);
  }, []);
  return {
    references: {
      ...selected,
      add,
      blockedReason:
        selected.blockedReason ?? inputFilesReason([...options.staged, ...files], options.model),
    },
    commit,
  };
}
