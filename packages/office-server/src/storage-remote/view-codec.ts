import { decodeWireSync } from "@starter/office-contract";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { prepareSdkSnapshot } from "./producer.ts";
import type { SnapshotIdentity } from "./native-envelope.ts";

/** Existing immutable Ready View artifact format; no alternate native serializer or authority. */
export function decodeNativeViewSnapshot(
  bytes: Uint8Array,
  expected: SnapshotIdentity,
  maximum: number,
) {
  const native = decodeWireSync(SnapshotWithBlocksSchema)(
    decodeNativeFrame(bytes, "merge-artifact").payload,
  );
  prepareSdkSnapshot(native.snapshot, native.sheetBlocks, expected, maximum);
  return native;
}
