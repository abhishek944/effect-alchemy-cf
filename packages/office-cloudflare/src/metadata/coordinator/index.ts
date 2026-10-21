import type { OfficeProviderOptions } from "../store.ts";
import { MetadataStore, storeEffect } from "../store.ts";
import { captureContext } from "./context.ts";
import { readPlacement, place } from "./placement.ts";
import { acquireCore } from "./turn-acquire.ts";
import { changeTurn } from "./turn-change.ts";
import type { CoordinatorControl, VerifiedCoordinatorContext } from "./types.ts";

export { initializeCoordinatorSchema, coordinatorSchemaVersion } from "./schema.ts";
export { createNativeReceiptObserver } from "./receipt-observer.ts";
export { createNativeWritePreparation } from "../native-host-preparation.ts";
export { createNativeEditorAdmission } from "../native-editor-admission.ts";
export type {
  NativeEditorAdmission,
  EditorAdmissionResult,
  JoinedChannel,
} from "../native-editor-schema.ts";
export type { CoordinatorControl, VerifiedCoordinatorContext } from "./types.ts";

/** Trusted persistence facade only. T47 must authenticate BEFORE supplying the REQUIRED context. */
export function createCoordinatorControl(
  options: OfficeProviderOptions,
  verifiedContext: VerifiedCoordinatorContext,
): CoordinatorControl {
  const db = new MetadataStore(options);
  const context = captureContext(db, verifiedContext);
  return {
    placement: (document) => storeEffect(() => readPlacement(db, context, document)),
    place: (document, change) => storeEffect(() => place(db, context, document, change)),
    acquireCore: (id, placementId, target, request) =>
      storeEffect(() => acquireCore(db, context, id, placementId, target, request)),
    changeTurn: (id, version, action) =>
      storeEffect(() => changeTurn(db, context, id, version, action)),
  };
}
