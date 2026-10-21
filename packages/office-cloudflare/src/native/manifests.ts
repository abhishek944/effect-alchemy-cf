import { assertSnapshotHeaders } from "./value-proofs.ts";
import type { ISnapshot, ISheetBlock } from "@univerjs/protocol";
import type { NativeDatabase } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import { boundedID, metadata, nativeLimits, NativeStorageError, revision } from "./types.ts";
import type { NativeSnapshotRefs, NativeValueRef } from "./types.ts";

export { Piece, Value, Snapshot } from "./ref-shapes.ts";
import { readSnapshotRefs } from "./ref-shapes.ts";
export async function validateSnapshotManifest(
  db: NativeDatabase,
  payloads: NativePayloads,
  input: NativeSnapshotRefs,
): Promise<NativeSnapshotRefs> {
  const manifest = readSnapshotRefs(input);
  db.check(undefined, manifest.unitID);
  revision(manifest.revision);
  if (
    ![1, 2, 3].includes(manifest.type) ||
    manifest.blocks.length > nativeLimits.blocks ||
    new Set(manifest.blocks.map((b) => b.blockID)).size !== manifest.blocks.length
  ) {
    throw new NativeStorageError(
      "LIMIT",
      "Unsupported native type or duplicate/oversized block manifest",
    );
  }
  let bytes = manifest.snapshot.bytes;
  const values = [manifest.snapshot, ...manifest.blocks.map((block) => block.value)];
  if (
    manifest.snapshot.kind !== "snapshot" ||
    manifest.blocks.some(
      (block) => block.value.kind !== "block" || block.value.bytes > nativeLimits.blockBytes + 1024,
    )
  )
    throw new NativeStorageError("CONTENT", "Native manifest kind/block size mismatch");
  for (const value of values) {
    if (
      !Number.isSafeInteger(value.bytes) ||
      value.bytes < 1 ||
      !value.parts.length ||
      value.parts.length > nativeLimits.parts ||
      value.parts.some(
        (part, index) => index < value.parts.length - 1 && part.bytes !== nativeLimits.pieceBytes,
      ) ||
      value.bytes !== value.parts.reduce((n, p) => n + p.bytes, 0)
    ) {
      throw new NativeStorageError("CONTENT", "Invalid native value part lengths");
    }
  }
  for (const block of manifest.blocks) {
    boundedID(block.blockID);
    bytes += block.value.bytes;
  }
  if (bytes > nativeLimits.aggregateBytes)
    throw new NativeStorageError("LIMIT", "Native aggregate exceeds byte limit");
  await payloads.verifyPieces(values.flatMap((value) => [...value.parts]));
  await assertSnapshotHeaders(db, manifest);
  metadata(manifest, nativeLimits.manifestBytes);
  return {
    ...manifest,
    blocks: manifest.blocks.toSorted((left, right) =>
      left.blockID < right.blockID ? -1 : left.blockID > right.blockID ? 1 : 0,
    ),
  };
}

export async function stageSnapshotValues(
  db: NativeDatabase,
  payloads: NativePayloads,
  snapshot: ISnapshot,
  blocks: readonly ISheetBlock[],
): Promise<NativeSnapshotRefs> {
  db.check(undefined, snapshot.unitID);
  revision(snapshot.rev);
  const required = new Set(
    Object.values(snapshot.workbook?.blockMeta ?? {}).flatMap((b) => b.blocks),
  );
  const supplied = new Set(blocks.map((b) => b.id));
  if (blocks.length !== supplied.size || [...required].some((id) => !supplied.has(id))) {
    throw new NativeStorageError("CONTENT", "Missing or duplicate native snapshot blocks");
  }
  if (blocks.length > 32)
    throw new NativeStorageError(
      "LIMIT",
      "SDK facade accepts at most 32 blocks per Worker call; use staged native references",
    );
  const refs: { blockID: string; value: NativeValueRef }[] = [];
  for (const block of blocks) {
    if (block.data.byteLength > nativeLimits.blockBytes)
      throw new NativeStorageError("LIMIT", "Native block exceeds 8 MiB");
    refs.push({ blockID: boundedID(block.id), value: await payloads.stageValue("block", block) });
  }
  return {
    unitID: snapshot.unitID,
    type: snapshot.type,
    revision: snapshot.rev,
    snapshot: await payloads.stageValue("snapshot", snapshot),
    blocks: refs,
  };
}
