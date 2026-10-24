import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Receipt } from "@starter/office-contract";
import type { OfficeEditorHandle, OfficeSave, OfficeRuntime } from "@starter/office-react";
import { drainOffice, openOffice, type OpenOffice } from "@/lib/office-runtime";
import { checkpointOfficeSendTarget } from "@/lib/office-anchor";
import type { OfficeSelection } from "./workspace-preview-model";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useOfficeEditorLease } from "./use-office-editor-lease";

type Control = "ready" | "review" | "reopen";

/** Owns this actual editor's load, native ACK and server drain; no guessed save or latest Send target. */
export function useOfficeSurface(chatId: string, id: string, selection: OfficeSelection) {
  const { runtime: runtimePromise, register, beginCommand } = useWorkspaceOffice();
  const [captured] = useState(selection);
  const [owner] = useState(() => ({}));
  const [handle, native] = useState<OfficeEditorHandle | null>(null);
  const pending = useRef<{ id: string; control: Control } | null>(null);
  const [pendingControl, setPendingControl] = useState<Control | null>(null);
  const command = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  const loading = useRef<Promise<void> | null>(null);
  const [value, setValue] = useState<OpenOffice | null>(null);
  const [runtime, setRuntime] = useState<OfficeRuntime | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reviewId, setReviewId] = useState(captured.reviewId);
  const retired = useRef(captured.reviewId !== null);
  useOfficeEditorLease(runtime, value, handle, busy, setValue, setError);
  useEffect(() => {
    const active = new AbortController();
    lifetime.current = active;
    loading.current = runtimePromise
      .then(async (resolved) => {
        if (!active.signal.aborted) setRuntime(resolved);
        return captured.reviewId === null
          ? openOffice(resolved, captured.target, active.signal)
          : null;
      })
      .then((result) => {
        if (!active.signal.aborted) setValue(result);
        return undefined;
      })
      .catch(() => {
        if (!active.signal.aborted)
          setError("Office could not be opened. No editor save is claimed.");
      });
    return () => {
      active.abort();
    };
  }, [runtimePromise, captured]);
  /** This editor's one save: native finish, ACK identity, server drain. Concurrent callers share it. */
  const saving = useRef<Promise<OfficeSave | null> | null>(null);
  const holdAndDrain = useCallback((): Promise<OfficeSave | null> => {
    if (saving.current !== null) return saving.current;
    const started = (async (): Promise<OfficeSave | null> => {
      await loading.current;
      const opened = value;
      if (retired.current || opened === null || opened.editor === null) return null;
      if (opened.view.mode !== "edit") return null;
      const acknowledged = await handle?.prepareToLeave();
      if (acknowledged === undefined)
        throw new Error("Native save acknowledgement is unavailable.");
      if (acknowledged.viewId !== opened.view.id)
        throw new Error("The native save acknowledgement belongs to another editor.");
      if (opened.editor.state === "drained") return acknowledged;
      const active = lifetime.current;
      if (active === null) throw new Error("Office scope is unavailable.");
      const next = await drainOffice(await runtimePromise, opened, acknowledged, active.signal);
      setValue(next);
      setError(""); // A confirmed drain clears prior save/drain failure state.
      return acknowledged;
    })();
    const tracked: Promise<OfficeSave | null> = started.finally(() => {
      if (saving.current === tracked) saving.current = null;
    });
    saving.current = tracked;
    return tracked;
  }, [runtimePromise, handle, value]);
  useLayoutEffect(
    () =>
      register(id, {
        chatId,
        owner,
        readOnly: captured.reviewId !== null && !busy,
        prepareToLeave: async () => {
          if (command.current || pending.current !== null)
            throw new Error("Check the original Office operation before leaving.");
          await holdAndDrain();
          if (command.current || pending.current !== null)
            throw new Error("An Office operation started during the barrier.");
        },
        prepareSend: async () => {
          if (retired.current) return null; // Artifact review Views never seed editable anchors.
          if (command.current || pending.current !== null)
            throw new Error("Finish the Office operation before Send.");
          const opened = value;
          const acknowledged = await holdAndDrain();
          if (command.current || pending.current !== null)
            throw new Error("An Office operation started during Send.");
          if (opened === null) throw new Error("Office is not ready.");
          const active = lifetime.current;
          if (active === null) throw new Error("Office scope is unavailable.");
          return checkpointOfficeSendTarget(
            await runtimePromise,
            captured.target,
            opened,
            acknowledged,
            active.signal,
          );
        },
      }),
    [register, id, chatId, captured, holdAndDrain, owner, busy, value, runtimePromise],
  );
  const act = async (reacquire: boolean) => {
    if (command.current || pending.current !== null) return;
    command.current = true;
    setBusy(true);
    setError("");
    try {
      const saved = await holdAndDrain();
      if (!reacquire) return;
      if (saved === null) throw new Error("Office is not open for native editing.");
      const active = lifetime.current;
      if (active === null) throw new Error("Office scope is unavailable.");
      // A fresh authorized session for the live head; the server decides grant eligibility.
      setValue(await openOffice(await runtimePromise, captured.target, active.signal));
    } catch {
      setError(
        reacquire
          ? "Editor reacquisition is unconfirmed. Keep this saved tab open; retry or reopen it from Files."
          : "Native save or server drain is unconfirmed. Keep this editor mounted and retry.",
      );
    } finally {
      command.current = false;
      setBusy(false);
    }
  };
  const admit = (control: Control) => {
    if (command.current || (pending.current !== null && pending.current.control !== control))
      return null;
    return beginCommand(); // Existing global owner, plus this scope\'s still-pending controller.
  };
  const onOperation = (operationId: string, control: Control) => {
    if (pending.current !== null && pending.current.id !== operationId)
      throw new Error("Check the original Office operation before starting another.");
    pending.current = { id: operationId, control };
    setPendingControl(control);
    setBusy(true);
  };
  const onReceipt = (result: Receipt) => {
    if (result.operationId !== pending.current?.id) {
      setError("Office receipt identity mismatch.");
      return;
    }
    setReceipt(result);
    if (
      result.kind === "ready" &&
      result.phase === "confirmed" &&
      result.reviewId !== null &&
      result.documentId === captured.target.documentId &&
      captured.target.scope.kind === "draft" &&
      result.draftId === captured.target.scope.draftId
    ) {
      retired.current = true;
      setReviewId(result.reviewId);
    }
    if (
      ["confirmed", "failed-before-submit", "cancelled-before-dispatch", "conflict"].includes(
        result.phase,
      )
    ) {
      pending.current = null;
      setPendingControl(null);
      setBusy(false);
    }
  };
  return {
    native,
    handle,
    runtime,
    value,
    error,
    busy,
    receipt,
    reviewId,
    pendingControl,
    admit,
    holdAndDrain,
    save: () => act(false),
    resume: () => act(true),
    onOperation,
    onReceipt,
    onBusy: (active: boolean) => {
      command.current = active;
      setBusy(active);
    },
  };
}
