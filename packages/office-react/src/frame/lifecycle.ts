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
  const subscription = entity?.status$.subscribe((status) => {
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
  });
  const flush = async () => {
    if (disposed) throw new Error("Office editor disposed.");
    if (collaboration === null) return view.revision;
    await collaboration.flush(unitId, { timeout: 30_000 });
    if (disposed || collaboration.getCollaborationStatus(unitId) !== CollaborationStatus.SYNCED)
      throw new Error("Office saves are not acknowledged.");
    const confirmed = revision();
    if (!Number.isSafeInteger(confirmed) || confirmed < 1)
      throw new Error("Office revision unavailable.");
    return confirmed;
  };
  const perform = async () => {
    if (composing) throw new Error("Finish composing text before leaving.");
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
      throw error;
    }
  };
  const hold = async () => {
    if (disposed) throw new Error("Office editor disposed.");
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
        emit("saving");
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
