import { Schema } from "effect";
import { acceptedHeader } from "../metadata/coordinator/accepted-header.ts";
import type {
  NativeAdmission,
  NativeFence,
  NativePublicationPreparation,
  NativeValueRef,
} from "./types.ts";
import { objectFields, parseMetadata, NativeName } from "./metadata-parse.ts";
const Prepared = Schema.Struct({
  writeId: NativeName,
  payloadDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
});
/** Fixed provider-private condition, never a SQL callback or a post-publication receipt retrofit. */
export async function prepareNativePublication(
  prepare: NativePublicationPreparation,
  scope: string,
  fence: NativeFence,
  action: string,
  fingerprint: string,
  admission?: NativeAdmission,
  value?: NativeValueRef,
) {
  const result = await prepare(
    { action, fingerprint, authorityEpoch: fence.epoch },
    structuredClone(fence),
  );
  const expected = parseMetadata(Prepared, objectFields(result, ["writeId", "payloadDigest"]));
  const header = await acceptedHeader(
    scope,
    fence,
    action,
    fingerprint,
    expected,
    admission,
    value,
  );
  return {
    statements: header.statements,
    condition: `EXISTS(SELECT 1 FROM office_native_prepared_slots WHERE scope=? AND command_id=? AND step_id=?
      AND action=? AND write_id=? AND payload_digest=? AND fingerprint=? AND epoch=? AND enabled=1)
      ${
        admission
          ? `AND EXISTS(SELECT 1 FROM office_coord_preparations WHERE scope=? AND command_id=?
        AND step_id=? AND action=? AND write_id=? AND payload_digest=? AND fingerprint=?
        AND original_epoch=? AND turn_id=? AND turn_fence=?)`
          : ""
      } AND (${header.condition})`,
    values: [
      scope,
      fence.commandID,
      fence.stepID,
      action,
      expected.writeId,
      expected.payloadDigest,
      fingerprint,
      fence.epoch,
      ...(admission
        ? [
            scope,
            fence.commandID,
            fence.stepID,
            action,
            expected.writeId,
            expected.payloadDigest,
            fingerprint,
            fence.epoch,
            admission.turnId,
            admission.fence,
          ]
        : []),
      ...header.values,
    ],
  };
}
