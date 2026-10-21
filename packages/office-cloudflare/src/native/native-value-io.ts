import type { IChangeset, ISheetBlock, ISnapshot } from "@univerjs/protocol";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type { NativeDatabase } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import type { NativePayloadKind, NativePieceRef, NativeValueRef } from "./types.ts";
import { metadata, nativeLimits, NativeStorageError } from "./types.ts";
import { encodeNativePayload, decodeNativePayload } from "./codec.ts";
import { readNativeSnapshot, readNativeBlock, readNativeChangeset } from "./protocol-values.ts";
import { blockHeader, changesetHeader, snapshotHeader } from "./value-headers.ts";
import { registerValidatedValue, verifiedHeaders } from "./value-proofs.ts";

type NativeData = ISnapshot | ISheetBlock | IChangeset;
export async function stageNativeValue(
  db: NativeDatabase,
  payloads: NativePayloads,
  kind: NativePayloadKind,
  value: NativeData,
): Promise<NativeValueRef> {
  db.assertWritable();
  const bytes = encodeNativePayload(kind, value);
  const header =
    kind === "snapshot"
      ? await snapshotHeader(readNativeSnapshot(value))
      : kind === "block"
        ? blockHeader(readNativeBlock(value))
        : changesetHeader(readNativeChangeset(value));
  if (header.kind !== "block") db.check(undefined, header.unitID);
  const parts: NativePieceRef[] = [];
  for (let offset = 0; offset < bytes.length; offset += nativeLimits.pieceBytes) {
    parts.push(await payloads.stagePiece(bytes.subarray(offset, offset + nativeLimits.pieceBytes)));
  }
  const ref: NativeValueRef = { codec: NATIVE_WIRE_CODEC, kind, bytes: bytes.length, parts };
  await registerValidatedValue(db, ref, header);
  return ref;
}
export async function loadNativeValue(
  db: NativeDatabase,
  payloads: NativePayloads,
  input: NativeValueRef,
  kind: NativePayloadKind,
): Promise<NativeData> {
  const ref = await payloads.verifyValue(input, kind);
  const header = (await verifiedHeaders(db, [ref]))[0];
  const bytes = new Uint8Array(ref.bytes);
  let offset = 0;
  for (const part of ref.parts) {
    bytes.set(await payloads.loadPiece(part), offset);
    offset += part.bytes;
  }
  const raw = decodeNativePayload(kind, bytes);
  if (kind === "snapshot") {
    const value = readNativeSnapshot(raw);
    db.check(undefined, value.unitID);
    if (metadata(await snapshotHeader(value)) !== metadata(header))
      throw new NativeStorageError(
        "CONTENT",
        "Decoded snapshot disagrees with its verified header",
      );
    return value;
  }
  if (kind === "block") {
    const value = readNativeBlock(raw);
    if (metadata(blockHeader(value)) !== metadata(header))
      throw new NativeStorageError("CONTENT", "Decoded block disagrees with its verified header");
    return value;
  }
  const value = readNativeChangeset(raw);
  db.check(undefined, value.unitID);
  if (metadata(changesetHeader(value)) !== metadata(header))
    throw new NativeStorageError("CONTENT", "Decoded changeset disagrees with its verified header");
  return value;
}
