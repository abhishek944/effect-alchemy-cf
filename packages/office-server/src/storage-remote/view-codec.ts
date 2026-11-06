import { decodeWireSync } from "@highchat/office-contract";
import { decodeNativeFrame } from "@highchat/office-contract/native-wire";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { prepareSdkSnapshot } from "./producer.ts";
import type { SnapshotIdentity } from "./native-envelope.ts";

/** Existing immutable Ready View artifact format; no alternate native serializer or authority. */
export function decodeNativeViewSnapshot(bytes: Uint8Array, expected: SnapshotIdentity) {
  const native = decodeWireSync(SnapshotWithBlocksSchema)(
    decodeNativeFrame(bytes, "merge-artifact").payload,
  );
  prepareSdkSnapshot(native.snapshot, native.sheetBlocks, expected);
  return native;
}
