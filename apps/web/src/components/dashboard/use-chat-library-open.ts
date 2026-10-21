import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import {
  getSavedFile,
  libraryReadMessage,
  readSavedOriginal,
  savedOriginalUrl,
} from "@/lib/chat-library-api";
import { useWorkspacePreview } from "./workspace-preview-context";

type Read = {
  scope: string;
  fileId: string;
  state: "idle" | "loading" | "ready" | "error";
  error: string | null;
};
type Pending = { controller: AbortController; scope: string; sequence: number };
// Multiple inline rows share one document's explicit viewing intent, not paid work.
let latestOpen: AbortController | null = null;

/** Explicit user opens only; stale chat/tab/background completions never navigate. */
export function useChatLibraryOpen({ active = true }: { active?: boolean } = {}) {
  const { selectedId, attachment } = useChatStore();
  const preview = useWorkspacePreview();
  const scope = JSON.stringify([selectedId, attachment]);
  const sequence = preview.focus.sequence;
  const latest = useRef<{
    scope: string;
    active: boolean;
    chatId: string | null;
    sequence: number;
    openImage: typeof preview.openImage;
  } | null>(null);
  const pending = useRef<Pending | null>(null);
  const [read, setRead] = useState<Read | null>(null);
  useLayoutEffect(() => {
    latest.current = { scope, active, chatId: selectedId, sequence, openImage: preview.openImage };
    return () => {
      latest.current = null;
    };
  }, [scope, active, selectedId, sequence, preview.openImage]);
  useEffect(() => {
    if (!active) pending.current?.controller.abort();
    return () => {
      const request = pending.current;
      if (request?.scope === scope && request.sequence === sequence) request.controller.abort();
    };
  }, [scope, active, sequence]);

  const open = useCallback(async (fileId: string): Promise<void> => {
    const origin = latest.current;
    if (!origin?.active || !origin.chatId) return;
    pending.current?.controller.abort();
    latestOpen?.abort();
    const request: Pending = {
      controller: new AbortController(),
      scope: origin.scope,
      sequence: origin.sequence,
    };
    pending.current = request;
    latestOpen = request.controller;
    const signal = AbortSignal.any([request.controller.signal, AbortSignal.timeout(15_000)]);
    const current = () =>
      pending.current === request &&
      latestOpen === request.controller &&
      !signal.aborted &&
      latest.current?.active &&
      latest.current.scope === origin.scope &&
      latest.current.sequence === origin.sequence;
    setRead({ scope: origin.scope, fileId, state: "loading", error: null });
    let settled = false;
    try {
      const file = await getSavedFile(origin.chatId, fileId, signal);
      if (file.kind === "text") await readSavedOriginal(file, signal);
      if (!current()) return;
      if (file.kind === "image") {
        latest.current?.openImage(file);
      } else {
        const link = document.createElement("a");
        link.href = savedOriginalUrl(file);
        link.download = file.name;
        link.click();
      }
      settled = true;
      setRead({ scope: origin.scope, fileId, state: "ready", error: null });
    } catch (error) {
      if (
        pending.current === request &&
        latestOpen === request.controller &&
        !request.controller.signal.aborted &&
        latest.current?.scope === origin.scope &&
        latest.current.active &&
        latest.current.sequence === origin.sequence
      ) {
        settled = true;
        setRead({ scope: origin.scope, fileId, state: "error", error: libraryReadMessage(error) });
      }
    } finally {
      if (latestOpen === request.controller) latestOpen = null;
      if (pending.current === request) {
        pending.current = null;
        if (!settled && latest.current?.scope === origin.scope)
          setRead({ scope: origin.scope, fileId, state: "idle", error: null });
      }
    }
  }, []);
  const currentRead = read?.scope === scope ? read : null;
  return {
    open,
    state: currentRead?.state ?? "idle",
    error: currentRead?.error ?? null,
    fileId: currentRead?.fileId ?? null,
    retry: () => (currentRead ? open(currentRead.fileId) : Promise.resolve()),
    dismiss: () => {
      pending.current?.controller.abort();
      pending.current = null;
      setRead(null);
    },
  };
}

export type ChatLibraryOpen = ReturnType<typeof useChatLibraryOpen>;
