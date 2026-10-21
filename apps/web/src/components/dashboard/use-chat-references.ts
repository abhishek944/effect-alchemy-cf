import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { getSavedFile, libraryReadMessage, readSavedOriginal } from "@/lib/chat-library-api";
import type { ReferenceRead, SavedFile } from "@/lib/chat-library-types";

export type ChatReferencesOptions = {
  chatId: string;
  files: readonly SavedFile[];
  onChange: (files: readonly SavedFile[]) => void;
  archived: boolean;
  /** Parent supplies the composer visibility; hidden original reads are aborted. */
  active?: boolean;
  scope?: string;
  lockedIds?: readonly string[];
};

/** Controlled draft references; identities never become uploads or paid actions. */
export function useChatReferences(options: ChatReferencesOptions) {
  const latest = useRef(options);
  const [reads, setReads] = useState<Readonly<Record<string, ReferenceRead>>>({});
  const pending = useRef(new Map<string, AbortController>());
  useLayoutEffect(() => {
    if (
      latest.current.chatId !== options.chatId ||
      latest.current.scope !== options.scope ||
      options.active === false
    )
      for (const controller of pending.current.values()) controller.abort();
    latest.current = options;
  }, [options]);
  const { chatId, files } = options;
  const active = options.active ?? true;
  const membership = JSON.stringify(files.map((file) => `${file.chatId}/${file.id}`));
  const [tracked, setTracked] = useState(membership);
  if (tracked !== membership) {
    const keys = new Set(files.map((file) => `${file.chatId}/${file.id}`));
    setTracked(membership);
    setReads((value) => Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key))));
  }
  useEffect(() => {
    const keys = new Set(files.map((file) => `${file.chatId}/${file.id}`));
    for (const [key, controller] of pending.current) {
      if (!active || !keys.has(key)) {
        controller.abort();
        if (!keys.has(key)) pending.current.delete(key);
      }
    }
  }, [files, active]);
  useEffect(() => {
    const controllers = pending.current;
    return () => {
      for (const controller of controllers.values()) controller.abort();
      controllers.clear();
    };
  }, []);

  const add = (file: SavedFile): boolean => {
    const current = latest.current;
    if (current.archived || file.chatId !== current.chatId || file.state !== "ready") return false;
    const read = reads[`${file.chatId}/${file.id}`];
    if (read && read.state !== "ready") return false;
    if (!current.files.some((item) => item.id === file.id))
      current.onChange([...current.files, file]);
    return true;
  };
  const remove = (id: string) => {
    const current = latest.current;
    if (current.archived || current.lockedIds?.includes(id)) return;
    const key = `${current.chatId}/${id}`;
    pending.current.get(key)?.abort();
    pending.current.delete(key);
    current.onChange(current.files.filter((file) => file.id !== id));
  };
  const retry = async (id: string) => {
    const current = latest.current;
    const file = current.files.find((item) => item.id === id && item.chatId === current.chatId);
    if (!file || current.active === false) return;
    const key = `${file.chatId}/${file.id}`;
    if (pending.current.has(key)) return;
    const controller = new AbortController();
    pending.current.set(key, controller);
    setReads((value) => ({ ...value, [key]: { state: "reading", error: null } }));
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    const stillSelected = () =>
      latest.current.chatId === file.chatId &&
      latest.current.scope === current.scope &&
      latest.current.active !== false &&
      latest.current.files.some((item) => item.id === id) &&
      !controller.signal.aborted;
    try {
      const saved = await getSavedFile(file.chatId, id, signal);
      await readSavedOriginal(saved, signal);
      if (!stillSelected()) return;
      const next = latest.current;
      next.onChange(
        next.files.map((item) => (item.id === id ? { ...saved, state: "ready" } : item)),
      );
      setReads((value) => ({ ...value, [key]: { state: "ready", error: null } }));
    } catch (error) {
      if (stillSelected())
        setReads((value) => ({
          ...value,
          [key]: { state: "error", error: libraryReadMessage(error) },
        }));
    } finally {
      if (pending.current.get(key) === controller) {
        pending.current.delete(key);
        if (
          controller.signal.aborted &&
          latest.current.chatId === file.chatId &&
          latest.current.files.some((item) => item.id === id)
        )
          setReads((value) => ({
            ...value,
            [key]: { state: "error", error: "Reading stopped. Retry reading the saved file." },
          }));
      }
    }
  };
  const readFor = (file: SavedFile): ReferenceRead =>
    reads[`${file.chatId}/${file.id}`] ?? {
      state: file.state === "ready" ? "ready" : "error",
      error: file.state === "ready" ? null : "Original unavailable",
    };
  const markUnavailable = useCallback((id: string, error = "Original unavailable") => {
    const current = latest.current;
    if (!current.files.some((file) => file.id === id)) return;
    const key = `${current.chatId}/${id}`;
    setReads((value) =>
      value[key]?.state === "error" && value[key]?.error === error
        ? value
        : { ...value, [key]: { state: "error", error } },
    );
  }, []);
  return {
    files: files.filter((file) => file.chatId === chatId),
    ids: files.filter((file) => file.chatId === chatId).map((file) => file.id),
    add,
    remove,
    retry,
    readFor,
    markUnavailable,
    blockedReason: files.some((file) => file.chatId !== chatId || readFor(file).state !== "ready")
      ? "Read or remove unavailable file references before sending."
      : null,
  };
}

export type ChatReferences = ReturnType<typeof useChatReferences>;
