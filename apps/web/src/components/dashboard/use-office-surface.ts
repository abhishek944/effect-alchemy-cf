import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Receipt } from "@starter/office-contract";
import type { OfficeEditorHandle, OfficeRuntime } from "@starter/office-react";
import { openOffice, type OpenOffice } from "@/lib/office-runtime";
import { prepareOfficeSendTarget } from "@/lib/office-anchor";
import type { OfficeSelection } from "./workspace-preview-model";
import { useWorkspaceOffice } from "./workspace-office-context";
import { panelKey } from "./workspace-office-scope";
import { useOfficeEditorLease } from "./use-office-editor-lease";
import { useOfficeSave } from "./use-office-save";

type Control = "ready" | "review" | "reopen" | "export";

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
  const lease = useOfficeEditorLease(runtime, value, handle, setValue, setError);
  const save = useOfficeSave({ lease, handle, loading, retired, report: setError });
  const { holdAndDrain } = save;
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
  useLayoutEffect(
    () =>
      register(chatId, id, {
        chatId,
        owner,
        readOnly: selection.reviewId !== null && !busy,
        prepareToLeave: async () => {
          if (command.current || pending.current !== null)
            throw new Error("Check the original Office operation before leaving.");
          await save.prepare();
          if (command.current || pending.current !== null)
            throw new Error("An Office operation started during the barrier.");
        },
        commitLeave: save.commit,
        cancelLeave: save.cancel,
        prepareSend: async () => {
          if (retired.current) return null; // Artifact review Views never seed editable anchors.
          if (command.current || pending.current !== null)
            throw new Error("Finish the Office operation before Send.");
          const opened = value;
          if (opened === null || handle === null) throw new Error("Office is not ready.");
          const active = lifetime.current;
          if (active === null) throw new Error("Office scope is unavailable.");
          const target = await prepareOfficeSendTarget(
            await runtimePromise,
            selection,
            opened,
            handle,
            active.signal,
          );
          if (command.current || pending.current !== null)
            throw new Error("An Office operation started during Send.");
          return target;
        },
      }),
    [register, id, chatId, selection, save, owner, busy, value, handle, runtimePromise],
  );
  const act = async (reacquire: boolean) => {
    if (command.current || pending.current !== null) return;
    command.current = true;
    setBusy(true);
    setError("");
    try {
      if (reacquire && lease.current()?.editor?.state !== "drained") {
        await save.prepare();
        await save.cancel();
        return;
      }
      const saved = await holdAndDrain();
      if (!reacquire) return;
      if (saved === null) throw new Error("Office is not open for native editing.");
      const active = lifetime.current;
      if (active === null) throw new Error("Office scope is unavailable.");
      // A fresh authorized session for the live head; the server decides grant eligibility.
      setValue(await openOffice(await runtimePromise, captured.target, active.signal));
      save.reset();
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
    return beginCommand(panelKey(chatId, id)); // This file's owner, plus this scope's pending controller.
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
    report: setError,
    referenceState: {
      current: lease.current,
      canResume: lease.canResume,
      blocked: () => retired.current || command.current || pending.current !== null,
      signal: () => lifetime.current?.signal ?? null,
    },
    runtime,
    value,
    error,
    busy,
    receipt,
    reviewId,
    pendingControl,
    admit,
    holdAndDrain,
    phase: save.phase,
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
