import { ArtifactRef, OfficeLimited, decodeWireSync, safeFailure } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { MetadataStore, canonical, conflict, invalid, sqlNow } from "../metadata/store.ts";
import type { OfficeProviderOptions } from "../metadata/store.ts";
import { MAX_ATTEMPTS, Pending, PutMetadata, assertKey, unknownOutcome } from "./data.ts";
import type { PutInput, RefRow, ObjectRow } from "./data.ts";

export class ByteStore extends MetadataStore {
  readonly graceMs: number;
  constructor(options: OfficeProviderOptions) {
    super(options);
    this.graceMs = options.orphanGraceMs ?? 86_400_000;
    if (
      !Number.isSafeInteger(this.graceMs) ||
      this.graceMs < 1000 ||
      this.graceMs > 30 * 86_400_000
    )
      throw invalid();
  }
  async scope(owner: OwnerScope): Promise<{ owner: string; prefix: string }> {
    const encoded = this.owner(owner);
    return {
      owner: encoded,
      prefix: `office/bytes/v1/${await this.hash([owner.stage, owner.ownerId])}/`,
    };
  }
  row(owner: string, id: string): Promise<RefRow | null> {
    return this.first(
      "SELECT key,created,state,record FROM office_bytes_refs WHERE owner=? AND id=?",
      [owner, id],
    );
  }
  object(owner: string, id: string, key: string): Promise<ObjectRow | null> {
    return this.first(
      "SELECT key,state,digest,bytes,etag FROM office_bytes_objects WHERE owner=? AND id=? AND key=?",
      [owner, id, key],
    );
  }
  cap(kind: ArtifactRef["kind"]): number {
    switch (kind) {
      case "code":
        return this.limits.codeBytes;
      case "upload":
        return this.limits.uploadBytes;
      case "native-proposal":
        return this.limits.proposalBytes;
      case "render":
        return this.limits.renderBytes;
      case "inspection":
        return this.limits.responseBytes;
      default:
        return this.limits.nativeBytes;
    }
  }
  metadata(input: PutInput) {
    const parsed = decodeWireSync(PutMetadata)({
      id: input.id,
      kind: input.kind,
      mediaType: input.mediaType,
      declaredBytes: input.declaredBytes,
      expectedDigest: input.expectedDigest,
    });
    if (parsed.declaredBytes > this.cap(parsed.kind))
      throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
    return parsed;
  }
  pending(input: PutInput): string {
    return this.encode(Pending, {
      id: input.id,
      kind: input.kind,
      mediaType: input.mediaType,
      bytes: input.declaredBytes,
    });
  }
  sameInput(ref: ArtifactRef, input: PutInput): void {
    if (
      ref.id !== input.id ||
      ref.kind !== input.kind ||
      ref.mediaType !== input.mediaType ||
      ref.bytes !== input.declaredBytes
    )
      throw conflict();
  }
  async reserve(owner: string, input: PutInput, key: string): Promise<RefRow> {
    await this.options.database
      .prepare(`INSERT OR IGNORE INTO office_bytes_refs(owner,id,key,created,state,record)
      VALUES(?,?,?,${sqlNow},'pending',?)`)
      .bind(owner, input.id, key, this.pending(input))
      .run();
    const row = await this.row(owner, input.id);
    if (!row) throw unknownOutcome();
    if (row.state === "ready") this.sameInput(this.decode(ArtifactRef, row.record), input);
    else if (row.state !== "pending" || row.record !== this.pending(input)) throw conflict();
    return row;
  }
  async begin(owner: string, input: PutInput, key: string): Promise<void> {
    await this.write(
      `EXISTS(SELECT 1 FROM office_bytes_refs WHERE owner=? AND id=? AND state='pending' AND record=?)
        AND (SELECT count(*) FROM office_bytes_objects WHERE owner=? AND id=?)<?`,
      [owner, input.id, this.pending(input), owner, input.id, MAX_ATTEMPTS],
      [
        [
          `INSERT INTO office_bytes_objects(key,owner,id,created,state)
        VALUES(?,?,?,${sqlNow},'writing')`,
          [key, owner, input.id],
        ],
      ],
      "IDEMPOTENCY_CONFLICT",
    );
  }
  async complete(
    owner: string,
    id: string,
    key: string,
    digest: string,
    bytes: number,
    etag: string,
  ): Promise<void> {
    try {
      await this.write(
        "EXISTS(SELECT 1 FROM office_bytes_objects WHERE owner=? AND id=? AND key=? AND state='writing')",
        [owner, id, key],
        [
          [
            "UPDATE office_bytes_objects SET state='complete',digest=?,bytes=?,etag=? WHERE key=? AND owner=? AND id=?",
            [digest, bytes, etag, key, owner, id],
          ],
        ],
      );
    } catch {
      const row = await this.object(owner, id, key);
      if (row?.state === "cleanup") {
        // This original PUT is now acknowledged/quiescent. A LATER GC pass must delete after this fence.
        await this.options.database
          .prepare(`UPDATE office_bytes_objects SET state='settled',digest=?,bytes=?,etag=?
          WHERE owner=? AND id=? AND key=? AND state='cleanup'`)
          .bind(digest, bytes, etag, owner, id, key)
          .run();
        throw unknownOutcome();
      }
      if (
        !row ||
        row.state !== "complete" ||
        row.digest !== digest ||
        row.bytes !== bytes ||
        row.etag !== etag
      )
        throw unknownOutcome();
    }
  }
  async publish(
    owner: string,
    input: PutInput,
    key: string,
    ref: ArtifactRef,
    prefix: string,
  ): Promise<ArtifactRef> {
    const record = this.encode(ArtifactRef, ref);
    try {
      await this.write(
        `EXISTS(SELECT 1 FROM office_bytes_refs WHERE owner=? AND id=? AND state='pending' AND record=?)
        AND EXISTS(SELECT 1 FROM office_bytes_objects WHERE owner=? AND id=? AND key=? AND state='complete' AND digest=? AND bytes=?)`,
        [owner, input.id, this.pending(input), owner, input.id, key, ref.digest, ref.bytes],
        [
          [
            "UPDATE office_bytes_refs SET key=?,state='ready',record=? WHERE owner=? AND id=?",
            [key, record, owner, input.id],
          ],
        ],
        "IDEMPOTENCY_CONFLICT",
      );
    } catch (cause) {
      const row = await this.row(owner, input.id);
      if (!row || row.state !== "ready") throw cause;
      assertKey(prefix, input.id, row.key);
      if (row.record !== canonical(ref)) throw conflict();
    }
    return ref;
  }
}
