import { Schema } from "effect";
import { Count, Digest, Revision } from "@starter/office-contract";
import { HostId, hostMethod } from "./host-wire.ts";
import { NativeValue, NativeSnapshot, NativePartRequest, NativePiece } from "./wire.ts";
import { HostNativeProducer } from "./producer-wire.ts";

const handle = { handleId: HostId };
export const HostValueHeader = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("snapshot"),
    unitID: HostId,
    type: NativeSnapshot.fields.type,
    revision: Revision,
    requiredBlocksDigest: Digest,
  }),
  Schema.Struct({
    kind: Schema.Literal("block"),
    blockID: HostId,
    startRow: Count,
    endRow: Count,
  }).check(Schema.makeFilter((header) => header.endRow >= header.startRow)),
  Schema.Struct({
    kind: Schema.Literal("changeset"),
    unitID: HostId,
    type: NativeSnapshot.fields.type,
    baseRev: Revision,
    revision: Revision,
    sid: Schema.NullOr(HostId),
    reqId: Schema.NullOr(Count),
  }).check(Schema.makeFilter((header) => header.revision === header.baseRev + 1)),
]);
export const HostNativePieces = Object.freeze({
  stage: hostMethod("native.piece-stage", Schema.Struct(handle), NativePiece),
  register: hostMethod(
    "native.value-register",
    Schema.Struct({
      ...handle,
      value: NativeValue,
      header: HostValueHeader,
      producer: HostNativeProducer,
    }).check(
      Schema.makeFilter(
        (input) =>
          !("kind" in input.producer) ||
          (input.header.kind === "changeset" && input.value.kind === "changeset"),
      ),
    ),
    NativeValue,
  ),
  read: hostMethod(
    "native.part-read",
    Schema.Struct({ ...handle, ...NativePartRequest.fields }),
    NativePiece,
  ),
});
/** SDK getSheetBlock resolves only exact refs from an already admitted snapshot/seed manifest. */
export const HostBlockSelection = Schema.Struct({ blockID: HostId, value: NativeValue });
