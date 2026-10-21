import { createHash } from "node:crypto";
import type { ISheetBlock, ISnapshot } from "@univerjs/protocol";
import { decodeWireSync } from "@starter/office-contract";
import { encodeNativeFrame } from "@starter/office-contract/native-wire";
import type { OfficeDependencies, WritePermit } from "../ports/index.ts";
import { officeFailure } from "../core/failure.ts";
import { NativeProducer } from "./wire.ts";
import { decodeBlock, decodeSnapshot, type SnapshotIdentity } from "./native-envelope.ts";
import { HostValueHeader } from "./adapter-piece-wire.ts";

const nativeId = (id: string): void => {
  const size = new TextEncoder().encode(id).byteLength;
  if (size < 1 || size > 256) throw officeFailure("LIMIT_EXCEEDED");
};

/** Trusted Node SDK boundary. Bytes alone, a self-declared kind or a completed ref confer no producer authority. */
export function prepareSdkSnapshot(
  input: ISnapshot,
  sheetBlocks: readonly ISheetBlock[],
  expected: SnapshotIdentity,
  maximum: number,
) {
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw officeFailure("LIMIT_EXCEEDED");
  const limit = Math.min(maximum, 128 * 1024 * 1024);
  const snapshotBytes = encodeNativeFrame("snapshot", input);
  const snapshot = decodeSnapshot(snapshotBytes, expected);
  nativeId(snapshot.unitID);
  const required = new Set<string>();
  for (const [sheetId, meta] of Object.entries(snapshot.workbook?.blockMeta ?? {})) {
    if (
      (meta.sheetID !== undefined && meta.sheetID !== sheetId) ||
      snapshot.workbook?.sheets[sheetId]?.id !== sheetId
    )
      throw officeFailure("CONTENT_REQUIRED");
    for (const id of meta.blocks) {
      nativeId(id);
      if (required.has(id)) throw officeFailure("CONTENT_REQUIRED");
      if (required.size >= 4096) throw officeFailure("LIMIT_EXCEEDED");
      required.add(id);
    }
  }
  if (sheetBlocks.length !== required.size || sheetBlocks.length > 4096)
    throw officeFailure("CONTENT_REQUIRED");
  const identity = new TextEncoder().encode(
    JSON.stringify(["office-native-block-ids", 1, [...required].toSorted()]),
  );
  if (identity.byteLength > 2 * 1024 * 1024) throw officeFailure("LIMIT_EXCEEDED");
  const snapshotHeader = decodeWireSync(HostValueHeader)({
    kind: "snapshot",
    unitID: snapshot.unitID,
    type: snapshot.type,
    revision: snapshot.rev,
    requiredBlocksDigest: createHash("sha256").update(identity).digest("hex"),
  });
  if (snapshotHeader.kind !== "snapshot") throw officeFailure("CONTENT_REQUIRED");
  let size = snapshotBytes.byteLength;
  if (size > limit) throw officeFailure("LIMIT_EXCEEDED");
  const seen = new Set<string>();
  const blocks = sheetBlocks.map((block) => {
    nativeId(block.id);
    if (!required.has(block.id) || seen.has(block.id)) throw officeFailure("CONTENT_REQUIRED");
    seen.add(block.id);
    const bytes = encodeNativeFrame("block", block);
    const decoded = decodeBlock(bytes, block.id);
    const blockHeader = decodeWireSync(HostValueHeader)({
      kind: "block",
      blockID: decoded.id,
      startRow: decoded.startRow,
      endRow: decoded.endRow,
    });
    if (blockHeader.kind !== "block") throw officeFailure("CONTENT_REQUIRED");
    size += bytes.byteLength;
    if (size > limit) throw officeFailure("LIMIT_EXCEEDED");
    return { id: block.id, bytes, blockHeader };
  });
  // Hash only binary frames and bounded native identities, never stringify a document model.
  const digest = createHash("sha256");
  digest.update("office-sdk-snapshot-v1\0");
  digest.update(snapshotBytes);
  for (const block of blocks.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    digest.update("\0");
    digest.update(block.id);
    digest.update("\0");
    digest.update(block.bytes);
  }
  return {
    snapshot: snapshotBytes,
    snapshotHeader,
    blocks,
    contentDigest: digest.digest("hex"),
    bytes: size,
  };
}
export function requireNativeProducer(
  value: unknown,
  permit: WritePermit,
  policy: OfficeDependencies["policy"],
  expected: SnapshotIdentity,
  contentDigest: string,
  source: NativeProducer["source"],
): NativeProducer {
  const producer = decodeWireSync(NativeProducer)(value);
  if (
    producer.operationId !== permit.operationId ||
    producer.stepId !== permit.stepId ||
    producer.unitID !== permit.target.unitId ||
    producer.unitID !== expected.unitID ||
    producer.type !== expected.type ||
    producer.revision !== expected.revision ||
    producer.policyVersion !== policy.version ||
    producer.sdkVersion !== policy.sdkVersion ||
    producer.imageDigest !== policy.imageDigest ||
    producer.contentDigest !== contentDigest ||
    producer.source !== source
  )
    throw officeFailure("FORBIDDEN", permit.operationId);
  return producer;
}
