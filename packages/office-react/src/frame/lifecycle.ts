import { IPermissionService } from "@univerjs/core";
import { setDocumentPermissionValue } from "@univerjs/docs";
import { WorkbookEditablePermission } from "@univerjs/sheets";
import { setSlidePermissionValue } from "@univerjs-pro/slides";
import { UnitAction } from "@univerjs/protocol";
import { RevisionService } from "@univerjs-pro/collaboration";
import { CollaborationController, CollaborationStatus } from "@univerjs-pro/collaboration-client";
import type { FrameInit, FrameStatus } from "./messages.ts";
import type { NativeApplication } from "./native.ts";
import { finishNativeInput } from "./editing.ts";
export type NativePhase = "input" | "flush";
const NATIVE_REASONS = [
  "disposed",
  "composing",
  "unacknowledged",
  "revision-unavailable",
  "native",
  "capture-changed",
  "capture-unavailable",
  "capture-unsupported",
];
/** Tag a lifecycle failure with a fixed phase/reason; the cause chain stays in memory. */
export function nativeFailure(
  phase: NativePhase,
  reason: string,
  message: string,
  cause?: unknown,
) {
  return Object.assign(new Error(message, cause === undefined ? undefined : { cause }), {
    phase,
    reason,
  });
}
/** Read back a failure tagged by this module; foreign errors stay unclassified. */
export function readNativeReason(error: unknown): { phase: NativePhase; reason: string } | null {
  if (typeof error !== "object" || error === null) return null;
  const { phase, reason } = error as { phase?: unknown; reason?: unknown };
  if (
    (phase === "input" || phase === "flush") &&
    typeof reason === "string" &&
    (NATIVE_REASONS as readonly string[]).includes(reason)
  )
    return { phase, reason };
  return null;
}
export function nativeLifecycle(
  native: NativeApplication,
  input: FrameInit,
  notify: (status: FrameStatus, revision: number) => void,
) {
  const { view } = input;
  const unitId = view.nativeTarget.unitId;
  const revisions = native.injector.get(RevisionService);
  const readOnly = view.mode === "read-only";
  let inputHeld = false;
  let composing = false;
  let disposed = false;
  let pending: Promise<number> | null = null;
  const revision = () => revisions.getCurrentRevOfUnit(unitId);
  const emit = (status: FrameStatus) => {
    if (!disposed) notify(status, revision());
  };
  const permission = native.injector.get(IPermissionService);
  if (readOnly) {
    if (view.kind === "sheet") {
      const point = new WorkbookEditablePermission(unitId);
      permission.addPermissionPoint(point);
      permission.updatePermissionPoint(point.id, false);
    } else if (view.kind === "doc")
      setDocumentPermissionValue(permission, unitId, unitId, UnitAction.Edit, false);
    else setSlidePermissionValue(permission, unitId, unitId, UnitAction.Edit, false);
  }
  if (readOnly) native.activity.seal(true);
  const eventTypes = [
    "pointerdown",
    "click",
    "dblclick",
    "contextmenu",
    "keydown",
    "beforeinput",
    "paste",
    "drop",
    "cut",
  ];
  const block = (event: Event) => {
    if (inputHeld) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  const startComposition = () => {
    composing = true;
  };
  const endComposition = () => {
    composing = false;
  };
  for (const type of eventTypes) document.addEventListener(type, block, true);
  document.addEventListener("compositionstart", startComposition, true);
  document.addEventListener("compositionend", endComposition, true);
  const collaboration =
    view.nativeTarget.kind === "pinned-snapshot" ? null : native.univerAPI.getCollaboration();
  const entity =
    view.nativeTarget.kind === "pinned-snapshot"
      ? null
      : native.injector.get(CollaborationController).getCollabEntity(unitId);
  const publishStatus = (status: CollaborationStatus) => {
    if (inputHeld) return;
    emit(
      status === CollaborationStatus.SYNCED
        ? readOnly
          ? "read-only"
          : "saved"
        : status === CollaborationStatus.OFFLINE
          ? "offline"
          : status === CollaborationStatus.CONFLICT
            ? "conflict"
            : "saving",
    );
  };
  const subscription = entity?.status$.subscribe(publishStatus);
  const flush = async () => {
    if (disposed) throw nativeFailure("flush", "disposed", "Office editor disposed.");
    if (collaboration === null) return view.revision;
    try {
      await collaboration.flush(unitId, { timeout: 30_000 });
    } catch (cause) {
      throw nativeFailure("flush", "native", "Native saves remain unconfirmed.", cause);
    }
    if (disposed || collaboration.getCollaborationStatus(unitId) !== CollaborationStatus.SYNCED)
      throw nativeFailure("flush", "unacknowledged", "Office saves are not acknowledged.");
    const confirmed = revision();
    if (!Number.isSafeInteger(confirmed) || confirmed < 1)
      throw nativeFailure("flush", "revision-unavailable", "Office revision unavailable.");
    return confirmed;
  };
  const perform = async () => {
    if (composing)
      throw nativeFailure("input", "composing", "Finish composing text before leaving.");
    inputHeld = true;
    native.activity.unseal();
    emit("holding");
    try {
      // Finish the already-admitted native input before sealing programmatic mutations.
      await finishNativeInput(native, input);
      await native.activity.wait();
      native.activity.seal(false);
      const confirmed = await flush();
      emit("held");
      return confirmed;
    } catch (error) {
      if (native.activity.idle()) native.activity.seal(false);
      emit("error");
      if (readNativeReason(error) !== null) throw error;
      throw nativeFailure("input", "native", "Native input could not be finished.", error);
    }
  };
  const hold = async () => {
    if (disposed) throw nativeFailure("input", "disposed", "Office editor disposed.");
    if (readOnly) return flush();
    if (pending !== null) return pending;
    pending = perform();
    try {
      return await pending;
    } finally {
      pending = null;
    }
  };
  emit(
    readOnly
      ? "read-only"
      : collaboration?.getCollaborationStatus(unitId) === CollaborationStatus.SYNCED
        ? "saved"
        : "saving",
  );
  return {
    hold,
    flush,
    fail() {
      inputHeld = true;
      native.activity.seal(false);
      emit("error");
    },
    resume() {
      if (!readOnly && !disposed) {
        native.activity.unseal();
        inputHeld = false;
        publishStatus(
          collaboration?.getCollaborationStatus(unitId) ?? CollaborationStatus.NOT_COLLAB,
        );
      }
    },
    dispose() {
      disposed = true;
      subscription?.unsubscribe();
      for (const type of eventTypes) document.removeEventListener(type, block, true);
      document.removeEventListener("compositionstart", startComposition, true);
      document.removeEventListener("compositionend", endComposition, true);
    },
  };
}
