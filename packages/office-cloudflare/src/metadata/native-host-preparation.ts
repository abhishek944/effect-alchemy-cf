import { NativeReceiptBinding } from "@starter/office-server/ports";
import type { NativeWriteRecord, Store, WritePermit } from "@starter/office-server/ports";
import type { NativeAdmission } from "../native/types.ts";
import { captureNativeAdmission } from "../native/admission-fence.ts";
import type { OfficeProviderOptions } from "./store.ts";
import { MetadataStore, canonical, conflict, storeEffect } from "./store.ts";
import { Permit, WriteRow } from "./schemas.ts";
import { prepareWrite } from "./write-preparation.ts";
import { preparedSlot } from "./write-context.ts";
import { nativeReceiptAction } from "./native-actions.ts";
import { completeRefs } from "./artifacts.ts";
import { captureContext, forbidden, requireContext } from "./coordinator/context.ts";
import { nativeAdmissionFence } from "./coordinator/fence.ts";
import { turnRow } from "./coordinator/rows.ts";
import type { VerifiedCoordinatorContext } from "./coordinator/types.ts";

/** Private owning preparation, not authentication or permission to retry a native dispatch. */
export function createNativeWritePreparation(
  options: OfficeProviderOptions,
  verifiedContext: VerifiedCoordinatorContext,
  inputAdmission: NativeAdmission,
): (
  permit: WritePermit,
  writeId: string,
  binding: NativeReceiptBinding,
) => Store<NativeWriteRecord> {
  const db = new MetadataStore(options),
    context = captureContext(db, verifiedContext),
    admission = captureNativeAdmission(inputAdmission);
  if (
    context.kind !== "core" ||
    context.purpose !== "native" ||
    context.authorizationDigest !== admission.authorizationDigest ||
    admission.notAfter > context.notAfter
  )
    throw forbidden();
  return (inputPermit, id, inputBinding) =>
    storeEffect(async () => {
      const permit = db.decode(Permit, db.encode(Permit, inputPermit)),
        binding = db.decode(NativeReceiptBinding, db.encode(NativeReceiptBinding, inputBinding));
      const key = await requireContext(db, context, context.document),
        saved = await turnRow(db, admission.turnId);
      if (
        !saved ||
        saved.row.scope !== key.scope ||
        saved.row.owner !== key.owner ||
        saved.value.fence !== admission.fence ||
        saved.value.mode !== "native" ||
        saved.value.placementId !== context.placementId ||
        saved.value.commandId !== permit.operationId ||
        saved.value.stepId !== permit.stepId ||
        saved.value.authorityEpoch !== permit.authorityEpoch ||
        saved.value.serviceEpoch !== permit.serviceEpoch ||
        saved.value.authorizationDigest !== admission.authorizationDigest ||
        admission.notAfter > saved.value.authNotAfter ||
        binding.authorityEpoch !== permit.authorityEpoch ||
        canonical(saved.value.origin) !== canonical(context.binding) ||
        canonical(saved.value.target) !== canonical(context.target) ||
        canonical(permit.target) !== canonical(context.target) ||
        canonical(permit.owner) !== canonical(context.document.owner) ||
        permit.documentId !== context.document.documentId ||
        permit.expectedHead !== saved.value.admission.expectedHead ||
        permit.expectedGeneration !==
          (context.target.scope.kind === "draft" ? context.target.scope.generation : null) ||
        permit.reviewFingerprint !== saved.value.admission.reviewFingerprint
      )
        throw forbidden();
      const live = nativeAdmissionFence(
        key.scope,
        admission,
        permit.operationId,
        permit.stepId,
        permit.authorityEpoch,
        "stage",
      );
      if (!(await db.first(`SELECT 1 WHERE ${live.sql}`, live.values)))
        throw conflict("AUTHORITY_LOST");
      // This prepares only the original staged journal/slot. It cannot publish without the map below.
      const write = await prepareWrite(db, permit, id, binding);
      if (write.phase !== "dispatching" || canonical(write.preparedReceipt) !== canonical(binding))
        throw conflict("OUTCOME_UNKNOWN");
      const action = nativeReceiptAction(write.receiptKey),
        slot = preparedSlot(db, permit.owner, write, binding),
        payload = completeRefs(db, permit.owner, [write.payload]);
      const tuple = [
        permit.operationId,
        permit.stepId,
        action,
        write.id,
        write.payload.digest,
        binding.fingerprint,
        binding.authorityEpoch,
        admission.turnId,
        admission.fence,
      ];
      await db.write(
        `(${live.sql}) AND (${slot.sql}) AND (${payload.sql})
        AND EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND write_id=? AND enabled=1)
        AND EXISTS(SELECT 1 FROM office_coord_turns WHERE id=? AND record=? AND subject='core')
        AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND id=? AND record=? AND binding=? AND phase='dispatching')
        AND NOT EXISTS(SELECT 1 FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=? AND action=?)
        AND NOT EXISTS(SELECT 1 FROM office_coord_preparations WHERE scope=?
          AND (write_id=? OR (command_id=? AND step_id=? AND action=?))
          AND (command_id,step_id,action,write_id,payload_digest,fingerprint,original_epoch,turn_id,turn_fence)
            <>(?,?,?,?,?,?,?,?,?))`,
        [
          ...live.values,
          ...slot.values,
          ...payload.values,
          key.scope,
          write.id,
          admission.turnId,
          saved.row.record,
          key.owner,
          write.id,
          db.encode(WriteRow, write),
          db.encode(Permit, permit),
          key.scope,
          permit.operationId,
          permit.stepId,
          action,
          key.scope,
          write.id,
          permit.operationId,
          permit.stepId,
          action,
          ...tuple,
        ],
        [
          [
            "INSERT OR IGNORE INTO office_coord_preparations VALUES(?,?,?,?,?,?,?,?,?,?)",
            [key.scope, ...tuple],
          ],
        ],
        "AUTHORITY_LOST",
      );
      await requireContext(db, context, context.document);
      if (!(await db.first(`SELECT 1 WHERE ${live.sql}`, live.values)))
        throw conflict("AUTHORITY_LOST");
      return write;
    });
}
