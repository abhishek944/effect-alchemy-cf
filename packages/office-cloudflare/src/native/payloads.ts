import { assertAuthority } from "./records.ts";
import { loadAdmittedPiece, putAdmittedPiece } from "./admission-fence.ts";
import { stageNativeValue, loadNativeValue } from "./native-value-io.ts";
import { verifiedHeaders, registerValidatedValue } from "./value-proofs.ts";
import { readValueHeader } from "./value-headers.ts";
import type { NativeValueHeader } from "./value-headers.ts";
import type { NativeProducerVerifier } from "./types.ts";
import { Schema } from "effect";
import { readPiece, readValue } from "./ref-shapes.ts";
import { boundedArray } from "./metadata-parse.ts";
import { Snapshot, validateSnapshotManifest, stageSnapshotValues } from "./manifests.ts";
import type { IChangeset, ISnapshot, ISheetBlock } from "@univerjs/protocol";
import type { NativeDatabase } from "./database.ts";
import { digest, metadata, nativeLimits, NativeStorageError } from "./types.ts";
import type {
  NativePieceRef,
  NativeValueRef,
  NativePayloadKind,
  NativeSnapshotRefs,
} from "./types.ts";

export class NativePayloads {
  private prefixPromise: Promise<string> | undefined;
  private readonly db: NativeDatabase;
  private readonly producer: NativeProducerVerifier | undefined;
  constructor(db: NativeDatabase, producer?: NativeProducerVerifier) {
    this.db = db;
    this.producer = producer;
  }
  async registerValue(
    input: NativeValueRef,
    inputHeader: NativeValueHeader,
  ): Promise<NativeValueRef> {
    await this.db.assertWriteAdmission();
    if (!this.producer)
      throw new NativeStorageError("SCOPE", "Verified native producer is required for raw refs");
    const value = readValue(input);
    const header = readValueHeader(inputHeader);
    if (value.kind !== header.kind)
      throw new NativeStorageError("CONTENT", "Native producer kind mismatch");
    await this.verifyPieces(value.parts);
    await this.producer.verifyProducer(
      structuredClone(value),
      structuredClone(header),
      structuredClone(this.db.fence),
    );
    await this.db.assertWriteAdmission();
    await registerValidatedValue(this.db, value, header);
    await this.db.assertWriteAdmission();
    return value;
  }
  private prefix(): Promise<string> {
    this.db.check();
    return (this.prefixPromise ??= digest(new TextEncoder().encode(this.db.key)).then(
      (key) => `office/native/v1/${key}/`,
    ));
  }
  async stagePiece(bytes: Uint8Array): Promise<NativePieceRef> {
    this.db.assertWritable();
    if (!bytes.length || bytes.length > nativeLimits.pieceBytes)
      throw new NativeStorageError("LIMIT", "Invalid native piece size");
    const hash = await digest(bytes);
    const key = `${await this.prefix()}${hash}`;
    await putAdmittedPiece(this.db, key, bytes, hash);
    const ref = { key, digest: hash, bytes: bytes.length };
    await this.db.write(
      "stage-piece",
      ref,
      [
        [
          "INSERT OR IGNORE INTO office_native_pieces VALUES(?,?,?,?)",
          [this.db.key, key, hash, bytes.length],
        ],
      ],
      "1",
      [],
      false,
    );
    return ref;
  }
  async verifyPiece(input: NativePieceRef): Promise<void> {
    const ref = readPiece(input);
    if (
      !/^[a-f0-9]{64}$/.test(ref.digest) ||
      ref.key !== `${await this.prefix()}${ref.digest}` ||
      !Number.isSafeInteger(ref.bytes) ||
      ref.bytes < 1 ||
      ref.bytes > nativeLimits.pieceBytes
    ) {
      throw new NativeStorageError("CONTENT", "Invalid native piece reference");
    }
    const object = await this.db.first(
      "SELECT 1 FROM office_native_pieces WHERE scope=? AND key=? AND digest=? AND bytes=?",
      [this.db.key, ref.key, ref.digest, ref.bytes],
    );
    if (!object) {
      throw new NativeStorageError("CONTENT", "Native piece is incomplete or missing");
    }
  }
  async verifyValue(input: NativeValueRef, kind: NativePayloadKind): Promise<NativeValueRef> {
    const value = readValue(input);
    if (value.kind !== kind) throw new NativeStorageError("CONTENT", "Native value kind mismatch");
    await this.verifyPieces(value.parts);
    await verifiedHeaders(this.db, [value]);
    return value;
  }
  async verifyPieces(input: readonly NativePieceRef[]): Promise<void> {
    const parts = boundedArray(input, nativeLimits.blocks + nativeLimits.parts).map(readPiece);
    const prefix = await this.prefix();
    for (const part of parts) {
      if (
        !/^[a-f0-9]{64}$/.test(part.digest) ||
        part.key !== prefix + part.digest ||
        !Number.isSafeInteger(part.bytes) ||
        part.bytes < 1 ||
        part.bytes > nativeLimits.pieceBytes
      ) {
        throw new NativeStorageError("CONTENT", "Invalid scoped native piece");
      }
    }
    const missing = await this.db.first(
      `SELECT 1 FROM json_each(?) p WHERE NOT EXISTS(
      SELECT 1 FROM office_native_pieces s WHERE s.scope=? AND s.key=json_extract(p.value,'$.key')
      AND s.digest=json_extract(p.value,'$.digest') AND s.bytes=json_extract(p.value,'$.bytes')) LIMIT 1`,
      [metadata(parts, nativeLimits.manifestBytes), this.db.key],
    );
    if (missing)
      throw new NativeStorageError("CONTENT", "Native manifest contains unstaged pieces");
  }
  stageValue(kind: "snapshot", value: ISnapshot): Promise<NativeValueRef>;
  stageValue(kind: "block", value: ISheetBlock): Promise<NativeValueRef>;
  stageValue(kind: "changeset", value: IChangeset): Promise<NativeValueRef>;
  async stageValue(
    kind: NativePayloadKind,
    value: ISnapshot | ISheetBlock | IChangeset,
  ): Promise<NativeValueRef> {
    return stageNativeValue(this.db, this, kind, value);
  }
  loadValue(ref: NativeValueRef, kind: "snapshot"): Promise<ISnapshot>;
  loadValue(ref: NativeValueRef, kind: "block"): Promise<ISheetBlock>;
  loadValue(ref: NativeValueRef, kind: "changeset"): Promise<IChangeset>;
  async loadValue(
    input: NativeValueRef,
    kind: NativePayloadKind,
  ): Promise<ISnapshot | ISheetBlock | IChangeset> {
    return loadNativeValue(this.db, this, input, kind);
  }
  async loadPiece(ref: NativePieceRef): Promise<Uint8Array> {
    if (!this.db.readGrant) await assertAuthority(this.db);
    await this.verifyPiece(ref);
    const bytes = await loadAdmittedPiece(this.db, ref);
    await this.db.assertReadable();
    if (!this.db.readGrant) await assertAuthority(this.db);
    return bytes;
  }
  async stageSnapshot(
    snapshot: ISnapshot,
    blocks: readonly ISheetBlock[] = [],
  ): Promise<NativeSnapshotRefs> {
    this.db.assertWritable();
    return stageSnapshotValues(this.db, this, snapshot, blocks);
  }
  async publishManifest(input: NativeSnapshotRefs): Promise<NativePieceRef> {
    this.db.assertWritable();
    const manifest = await validateSnapshotManifest(this.db, this, input);
    return this.stagePiece(
      new TextEncoder().encode(metadata(manifest, nativeLimits.manifestBytes)),
    );
  }
  async readManifest(ref: NativePieceRef): Promise<NativeSnapshotRefs> {
    if (ref.bytes > nativeLimits.manifestBytes)
      throw new NativeStorageError("LIMIT", "Native manifest too large");
    return Schema.decodeUnknownSync(Schema.fromJsonString(Snapshot))(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await this.loadPiece(ref)),
    );
  }
  async readSnapshot(
    ref: NativePieceRef,
  ): Promise<{ snapshot: ISnapshot; sheetBlocks: ISheetBlock[] }> {
    const manifest = await this.readManifest(ref);
    const snapshot = await this.loadValue(manifest.snapshot, "snapshot");
    const sheetBlocks: ISheetBlock[] = [];
    for (const block of manifest.blocks)
      sheetBlocks.push(await this.loadValue(block.value, "block"));
    return { snapshot, sheetBlocks };
  }
  stageChangeset(changeset: IChangeset): Promise<NativeValueRef> {
    return this.stageValue("changeset", changeset);
  }
}
