import { useEffect, useRef, useState } from "react";
import type { DraftTransition, Receipt } from "@starter/office-contract";
import type { OfficeRuntime } from "@starter/office-react";
import type { OfficeSelection } from "./workspace-preview-model";
import { useWorkspacePreview } from "./workspace-preview-context";

type Attempt = { readonly input: DraftTransition; readonly documentId: string; confirmed: boolean };
type Phase = "idle" | "pending" | "confirmed" | "failed";

/** One actual Human ready→draft request; uncertain attempts only observe the original selector. */
export function OfficeReopen({
  chatId,
  runtime,
  selection,
  onOperation,
  onReceipt,
  admit,
  disabled,
}: {
  chatId: string;
  runtime: OfficeRuntime;
  selection: OfficeSelection;
  onOperation: (id: string) => void;
  onReceipt: (receipt: Receipt) => void;
  admit: () => (() => void) | null;
  disabled: boolean;
}) {
  const preview = useWorkspacePreview();
  const [captured] = useState(selection);
  const original = useRef<Attempt | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => () => controller.current?.abort(), []);
  const act = async () => {
    if (controller.current !== null || phase === "failed") return;
    const scope = captured.target.scope;
    if (scope.kind !== "draft") return;
    const release = admit();
    if (release === null) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setMessage("");
    try {
      let attempt = original.current;
      if (attempt?.confirmed) {
        const next = await runtime.run(
          runtime.client.office.draft({ params: { draftId: attempt.input.draftId } }),
          { signal: active.signal },
        );
        if (active.signal.aborted) return;
        if (
          next.id !== attempt.input.draftId ||
          next.documentId !== attempt.documentId ||
          next.generation !== attempt.input.generation + 1 ||
          next.status !== "draft" ||
          next.publication !== "none"
        )
          throw new Error("Reopened scope changed.");
        release(); // Existing preview transition must claim its OWN gate, not deadlock on ours.
        // Publish into the origin workspace; the reveal guard keeps a hidden origin in the
        // background even if another chat is selected now.
        preview.openOfficeIn(
          chatId,
          {
            title: `${captured.title} · generation ${next.generation}`,
            target: {
              documentId: next.documentId,
              scope: { kind: "draft", draftId: next.id, generation: next.generation },
            },
            reviewId: null,
            attachments: captured.attachments,
          },
          true,
        );
        setMessage("Reopen confirmed. New-generation tab requested; the old review is unchanged.");
        return;
      }
      let receipt: Receipt;
      if (attempt === null) {
        const draft = await runtime.run(
          runtime.client.office.draft({ params: { draftId: scope.draftId } }),
          { signal: active.signal },
        );
        if (active.signal.aborted) return;
        if (
          draft.id !== scope.draftId ||
          draft.documentId !== captured.target.documentId ||
          draft.generation !== scope.generation ||
          draft.status !== "ready" ||
          draft.publication !== "none" ||
          draft.generation < 1 ||
          draft.generation === Number.MAX_SAFE_INTEGER
        )
          throw new Error("Only the exact Ready generation can be reopened.");
        attempt = {
          input: Object.freeze({
            operationId: crypto.randomUUID(),
            draftId: draft.id,
            generation: draft.generation,
          }),
          documentId: draft.documentId,
          confirmed: false,
        };
        original.current = attempt; // Retain before mutation, independent of React rendering.
        setPhase("pending");
        onOperation(attempt.input.operationId);
        receipt = await runtime.run(runtime.client.office.reopen({ payload: attempt.input }), {
          signal: active.signal,
        });
      } else {
        receipt = await runtime.run(
          runtime.client.office.receipt({ params: { operationId: attempt.input.operationId } }),
          { signal: active.signal },
        ); // No redispatch, new ID or current-generation replacement.
      }
      if (active.signal.aborted) return;
      if (
        receipt.operationId !== attempt.input.operationId ||
        receipt.kind !== "reopen" ||
        receipt.documentId !== attempt.documentId ||
        receipt.draftId !== attempt.input.draftId ||
        (receipt.phase === "confirmed" && receipt.acceptedRevision !== null)
      )
        throw new Error("Original reopen receipt mismatch.");
      onReceipt(receipt);
      if (receipt.phase === "confirmed") {
        attempt.confirmed = true;
        setPhase("confirmed");
        setMessage(
          "Reopen confirmed. Main is unchanged. Open the verified new generation to edit.",
        );
      } else if (
        ["failed-before-submit", "cancelled-before-dispatch", "conflict"].includes(receipt.phase)
      ) {
        setPhase("failed");
        setMessage(
          "This reopen did not complete. Its original receipt is retained; close and reopen the review for a new attempt.",
        );
      } else {
        setMessage(
          "Reopen is unconfirmed. Keep this review open and check the original operation.",
        );
      }
    } catch {
      if (!active.signal.aborted)
        setMessage(
          original.current === null
            ? "Only this exact Ready draft with no pending publication can be reopened. Main is unchanged."
            : original.current.confirmed
              ? "Reopen is confirmed, but its new editable generation could not be verified. Use Files to choose explicitly."
              : "Reopen is unconfirmed. Keep this review open and check the original operation; do not start another.",
        );
    } finally {
      controller.current = null;
      release();
      if (!active.signal.aborted) setBusy(false);
    }
  };
  if (captured.target.scope.kind !== "draft") return null;
  return (
    <div data-cx="office-actions">
      <button
        type="button"
        disabled={busy || disabled || phase === "failed"}
        onClick={(event) => {
          if (event.isTrusted) void act();
        }}
      >
        {phase === "pending"
          ? "Check reopen operation"
          : phase === "confirmed"
            ? "Open reopened draft"
            : "Reopen Ready draft for editing"}
      </button>
      <output data-cx="office-notice" aria-live="polite">
        {message}
      </output>
    </div>
  );
}
