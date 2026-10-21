import type { NativeDatabase } from "./database.ts";
import type { NativeValueRef, NativeSnapshotRefs, NativeChangesetRef } from "./types.ts";
import { digest, metadata, NativeStorageError } from "./types.ts";
import { blockIdentityDigest, readValueHeader } from "./value-headers.ts";
import type { NativeValueHeader } from "./value-headers.ts";
import { readValue } from "./ref-shapes.ts";
import { Schema } from "effect";

export async function valueFingerprint(input: NativeValueRef): Promise<string> {
  return digest(new TextEncoder().encode(metadata(readValue(input))));
}
export async function registerValidatedValue(
  db: NativeDatabase,
  input: NativeValueRef,
  inputHeader: NativeValueHeader,
): Promise<void> {
  const value = readValue(input);
  const header = readValueHeader(inputHeader);
  if (header.kind !== value.kind)
    throw new NativeStorageError("CONTENT", "Native producer kind mismatch");
  if (header.kind !== "block") db.check(undefined, header.unitID);
  const hash = await valueFingerprint(value);
  const stored = metadata(header);
  const old = await db.first<{ header: string }>(
    "SELECT header FROM office_native_values WHERE scope=? AND value_hash=?",
    [db.key, hash],
  );
  if (old) {
    if (old.header !== stored)
      throw new NativeStorageError(
        "CONFLICT",
        "Native value already has a different validated header",
      );
    return;
  }
  await db.write(
    "stage-validated-value",
    { valueHash: hash, header },
    [
      [
        "INSERT OR IGNORE INTO office_native_values VALUES(?,?,?,?)",
        [db.key, hash, value.kind, stored],
      ],
    ],
    "NOT EXISTS(SELECT 1 FROM office_native_values WHERE scope=? AND value_hash=? AND header<>?)",
    [db.key, hash, stored],
    false,
  );
}
export async function verifiedHeaders(
  db: NativeDatabase,
  values: readonly NativeValueRef[],
): Promise<readonly NativeValueHeader[]> {
  const hashes: string[] = [];
  for (let offset = 0; offset < values.length; offset += 16)
    hashes.push(...(await Promise.all(values.slice(offset, offset + 16).map(valueFingerprint))));
  const rows = await db.all<{ value_hash: string; header: string }>(
    "SELECT value_hash,header FROM office_native_values WHERE scope=? AND value_hash IN (SELECT value FROM json_each(?))",
    [db.key, metadata(hashes, 512 * 1024)],
  );
  const index = new Map(
    rows.map((row) => [
      row.value_hash,
      readValueHeader(Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown))(row.header)),
    ]),
  );
  return hashes.map((hash) => {
    const header = index.get(hash);
    if (!header)
      throw new NativeStorageError("CONTENT", "Native value has no verified producer header");
    return header;
  });
}
export async function assertSnapshotHeaders(
  db: NativeDatabase,
  refs: NativeSnapshotRefs,
): Promise<void> {
  const headers = await verifiedHeaders(db, [
    refs.snapshot,
    ...refs.blocks.map((block) => block.value),
  ]);
  const snapshot = headers[0];
  if (
    snapshot?.kind !== "snapshot" ||
    snapshot.unitID !== refs.unitID ||
    snapshot.type !== refs.type ||
    snapshot.revision !== refs.revision ||
    snapshot.requiredBlocksDigest !==
      (await blockIdentityDigest(refs.blocks.map((block) => block.blockID)))
  ) {
    throw new NativeStorageError(
      "CONTENT",
      "Snapshot header or complete block membership does not match native refs",
    );
  }
  for (let index = 0; index < refs.blocks.length; index++) {
    const header = headers[index + 1];
    if (header?.kind !== "block" || header.blockID !== refs.blocks[index]?.blockID)
      throw new NativeStorageError("CONTENT", "Block identity does not match native refs");
  }
}
export async function assertChangesetHeader(
  db: NativeDatabase,
  ref: NativeChangesetRef,
): Promise<void> {
  const header = (await verifiedHeaders(db, [ref.value]))[0];
  if (
    header?.kind !== "changeset" ||
    header.unitID !== ref.unitID ||
    header.type !== ref.type ||
    header.baseRev !== ref.baseRev ||
    header.revision !== ref.revision ||
    header.sid !== (ref.sid ?? null) ||
    header.reqId !== (ref.reqId ?? null)
  ) {
    throw new NativeStorageError("CONTENT", "Changeset header does not match native refs");
  }
}
