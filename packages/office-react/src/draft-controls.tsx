import { useEffect, useRef, useState } from "react";
import type { Draft, Editor, Receipt } from "@starter/office-contract";
import type { OfficeEditorHandle } from "./connection.ts";
import type { OfficeRuntime, OfficeActionAdmission } from "./runtime.ts";

export type OfficeDraftControlsProps = OfficeRuntime &
  OfficeActionAdmission & {
    readonly draft: Draft;
    readonly editor: Editor;
    readonly native: OfficeEditorHandle;
    readonly onOperation: (operationId: string) => void;
    readonly onReceipt: (receipt: Receipt) => void;
    readonly onBusy?: (busy: boolean) => void;
  };
/** Host owns leave guarding and editor reacquisition. This control never installs a router guard. */
function DraftControlSurface(props: OfficeDraftControlsProps) {
  const attempt = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [observe, setObserve] = useState(false);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const target = props.editor.view.nativeTarget;
  const allowed =
    props.draft.status === "draft" &&
    props.editor.state === "active" &&
    props.editor.view.mode === "edit" &&
    target.kind === "draft" &&
    props.editor.view.documentId === props.draft.documentId &&
    target.generation === props.draft.generation;
  const act = async () => {
    if (controller.current !== null || props.disabled || (!observe && !allowed)) return;
    const release = props.admit?.();
    if (props.admit !== undefined && typeof release !== "function") return;
    const active = new AbortController();
    controller.current = active;
    props.onBusy?.(true);
    setBusy(true);
    try {
      let receipt: Receipt;
      if (observe && attempt.current !== null) {
        receipt = await props.run(
          props.client.office.receipt({ params: { operationId: attempt.current } }),
          { signal: active.signal },
        );
      } else {
        const saved = await props.native.hold();
        if (active.signal.aborted) return;
        if (saved.viewId !== props.editor.view.id) throw new Error("Editor epoch changed.");
        const drained = await props.run(
          props.client.office.editor({
            payload: {
              kind: "drained",
              editorId: props.editor.id,
              confirmedRevision: saved.revision,
            },
          }),
          { signal: active.signal },
        );
        if (active.signal.aborted) return;
        if (
          drained.id !== props.editor.id ||
          drained.epoch !== props.editor.epoch ||
          drained.state !== "drained"
        )
          throw new Error("Editor save barrier is not acknowledged.");
        const operationId = crypto.randomUUID();
        attempt.current = operationId;
        props.onOperation(operationId);
        setObserve(true);
        receipt = await props.run(
          props.client.office.ready({
            payload: {
              operationId,
              draftId: props.draft.id,
              generation: props.draft.generation,
            },
          }),
          { signal: active.signal },
        );
      }
      if (active.signal.aborted) return;
      if (
        receipt.operationId !== attempt.current ||
        receipt.kind !== "ready" ||
        receipt.draftId !== props.draft.id ||
        receipt.documentId !== props.draft.documentId
      )
        throw new Error("Ready receipt identity mismatch.");
      props.onReceipt(receipt);
      setMessage(
        receipt.phase === "confirmed"
          ? "Draft frozen. Open its exact review."
          : (receipt.error?.message ??
              `Ready ${receipt.phase}. Keep this editor held; check the same operation.`),
      );
    } catch {
      if (!active.signal.aborted)
        setMessage(
          attempt.current === null
            ? "Native input or save barrier is unconfirmed. Keep the editor open; ask the host to resume or retry."
            : "Ready outcome unconfirmed. Check the original operation; do not repeat Ready.",
        );
    } finally {
      controller.current = null;
      props.onBusy?.(false);
      release?.();
      if (!active.signal.aborted) setBusy(false);
    }
  };
  return (
    <div data-office="draft-controls">
      <span>Draft · Main unchanged</span>
      <button
        type="button"
        disabled={busy || props.disabled || (!allowed && !observe)}
        onClick={(event) => {
          if (event.isTrusted) void act();
        }}
      >
        {observe ? "Check Ready operation" : "Ready for review"}
      </button>
      <output aria-live="polite">{message}</output>
    </div>
  );
}
export function OfficeDraftControls(props: OfficeDraftControlsProps) {
  return (
    <DraftControlSurface
      key={`${props.draft.id}:${props.draft.generation}:${props.editor.id}:${props.editor.epoch}:${props.editor.view.id}`}
      {...props}
    />
  );
}
