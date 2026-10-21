import { useEffect, useRef, useState } from "react";
import type { Receipt } from "@starter/office-contract";
import type { OfficeRuntime, OfficeActionAdmission } from "./runtime.ts";
import { reviewBlocker, reviewIdentity, type ReviewEvidence } from "./review-data.ts";

type Attempt = {
  readonly reviewId: string;
  readonly documentId: string;
  readonly approveId: string;
  readonly mergeId: string;
  step: "approve" | "merge";
  done: boolean;
};
export function useReviewActions(
  runtime: OfficeRuntime & OfficeActionAdmission,
  evidence: ReviewEvidence | null,
  onOperation: (id: string) => void,
  onReceipt: (receipt: Receipt) => void,
) {
  const attempt = useRef<Attempt | null>(null);
  const controller = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );
  const acceptReceipt = (value: Receipt, current: Attempt) => {
    const expected = current.step === "approve" ? current.approveId : current.mergeId;
    if (
      value.operationId !== expected ||
      value.kind !== current.step ||
      value.reviewId !== current.reviewId ||
      value.documentId !== current.documentId
    )
      throw new Error("Office receipt identity mismatch.");
    onReceipt(value);
    if (value.phase !== "confirmed") {
      if (
        value.phase === "failed-before-submit" ||
        value.phase === "cancelled-before-dispatch" ||
        value.phase === "conflict"
      ) {
        current.done = true;
        setPending(false);
      }
      setMessage(
        value.error?.message ??
          `Operation ${value.phase}. Check the same operation; do not repeat it.`,
      );
      return false;
    }
    return true;
  };
  const merge = async (current: Attempt, signal: AbortSignal) => {
    current.step = "merge";
    onOperation(current.mergeId);
    const receipt = await runtime.run(
      runtime.client.office.merge({
        payload: { operationId: current.mergeId, approvalOperationId: current.approveId },
      }),
      { signal },
    );
    if (signal.aborted) return;
    if (acceptReceipt(receipt, current)) {
      current.done = true;
      setPending(false);
      setMessage(
        `Published exact approved result${receipt.acceptedRevision === null ? "." : ` at Main r${receipt.acceptedRevision}.`}`,
      );
    }
  };
  const perform = async (observe: boolean) => {
    if (controller.current !== null || runtime.disabled) return;
    const release = runtime.admit?.();
    if (runtime.admit !== undefined && typeof release !== "function") return;
    setBusy(true);
    const active = new AbortController();
    controller.current = active;
    try {
      if (!observe) {
        if (evidence === null || reviewBlocker(evidence) !== null || attempt.current !== null)
          throw new Error("Complete a fresh exact review before approval.");
        const fresh = await runtime.run(
          runtime.client.office.review({
            params: { reviewId: evidence.page.reviewId },
            query: {},
          }),
          { signal: active.signal },
        );
        if (active.signal.aborted) return;
        if (
          reviewIdentity(fresh) !== reviewIdentity(evidence.page) ||
          fresh.approval !== "available" ||
          fresh.readiness !== "ready" ||
          fresh.diagnostics.length > 0 ||
          fresh.totalChanges !== evidence.changes.length
        )
          throw new Error("Review changed. Refresh result, exact changes and merge preview.");
        const current: Attempt = {
          reviewId: fresh.reviewId,
          documentId: fresh.documentId,
          approveId: crypto.randomUUID(),
          mergeId: crypto.randomUUID(),
          step: "approve",
          done: false,
        };
        attempt.current = current;
        setPending(true);
        onOperation(current.approveId);
        const receipt = await runtime.run(
          runtime.client.office.approve({
            payload: { operationId: current.approveId, reviewId: current.reviewId },
          }),
          { signal: active.signal },
        );
        if (active.signal.aborted) return;
        if (acceptReceipt(receipt, current)) await merge(current, active.signal);
      } else {
        const current = attempt.current;
        if (current === null || current.done) return;
        const receipt = await runtime.run(
          runtime.client.office.receipt({
            params: {
              operationId: current.step === "approve" ? current.approveId : current.mergeId,
            },
          }),
          { signal: active.signal },
        );
        if (active.signal.aborted) return;
        if (acceptReceipt(receipt, current)) {
          if (current.step === "approve") await merge(current, active.signal);
          else {
            current.done = true;
            setPending(false);
            setMessage("Exact publication confirmed.");
          }
        }
      }
    } catch {
      if (!active.signal.aborted)
        setMessage(
          attempt.current === null
            ? "Review could not be verified. Refresh before approving."
            : "Outcome unconfirmed. Check the original operation; do not submit another merge.",
        );
    } finally {
      controller.current = null;
      release?.();
      if (!active.signal.aborted) setBusy(false);
    }
  };
  return {
    busy,
    pending,
    message,
    attempted: attempt.current !== null,
    approve: () => perform(false),
    observe: () => perform(true),
  };
}
