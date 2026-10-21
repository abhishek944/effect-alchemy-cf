import {
  ArtifactRef,
  OfficeInvalid,
  OfficeLimited,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { conflict, invalid } from "../metadata/store.ts";
import { MAX_ATTEMPTS, assertKey, unknownOutcome } from "./data.ts";
import type { PutInput, RefRow } from "./data.ts";
import type { ByteStore } from "./store.ts";
import type { OwnerScope } from "@starter/office-server/ports";
import { transfer, writeObject } from "./stream.ts";

async function duplicate(
  db: ByteStore,
  owner: string,
  input: PutInput,
  row: RefRow,
  signal: AbortSignal,
): Promise<ArtifactRef> {
  const ref = db.decode(ArtifactRef, row.record);
  db.sameInput(ref, input);
  const actual = await transfer(input.body, input.declaredBytes, signal);
  if (input.expectedDigest !== null && actual.digest !== input.expectedDigest) throw invalid();
  if (actual.digest !== ref.digest) throw conflict();
  const current = await db.row(owner, input.id);
  if (
    !current ||
    current.state !== "ready" ||
    current.key !== row.key ||
    current.record !== row.record
  )
    throw conflict();
  return ref;
}

export async function putBytes(
  db: ByteStore,
  owner: OwnerScope,
  input: PutInput,
  signal: AbortSignal,
): Promise<ArtifactRef> {
  try {
    db.metadata(input);
    const scope = await db.scope(owner);
    const key = `${scope.prefix}${input.id}/${crypto.randomUUID()}`;
    const row = await db.reserve(scope.owner, input, key);
    assertKey(scope.prefix, input.id, row.key);
    if (row.state === "ready") return await duplicate(db, scope.owner, input, row, signal);
    try {
      await db.begin(scope.owner, input, key);
    } catch (cause) {
      const current = await db.row(scope.owner, input.id);
      if (current?.state === "ready") {
        assertKey(scope.prefix, input.id, current.key);
        return await duplicate(db, scope.owner, input, current, signal);
      }
      const count = await db.first<{ n: number }>(
        "SELECT count(*) n FROM office_bytes_objects WHERE owner=? AND id=?",
        [scope.owner, input.id],
      );
      if (count && count.n >= MAX_ATTEMPTS) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
      throw cause;
    }
    let actual: { digest: string; bytes: number; etag: string };
    try {
      actual = await writeObject(
        db.options.bucket,
        key,
        input,
        { scope: scope.prefix, id: input.id },
        signal,
      );
    } catch (cause) {
      // The R2 call may have committed before its acknowledgement was lost. Never publish/erase it here.
      await db.options.database
        .prepare(
          "UPDATE office_bytes_objects SET state='unknown' WHERE key=? AND owner=? AND id=? AND state='writing'",
        )
        .bind(key, scope.owner, input.id)
        .run()
        .catch(() => undefined);
      if (cause instanceof OfficeInvalid) throw cause;
      throw unknownOutcome();
    }
    await db.complete(scope.owner, input.id, key, actual.digest, actual.bytes, actual.etag);
    if (input.expectedDigest !== null && actual.digest !== input.expectedDigest) throw invalid();
    signal.throwIfAborted();
    const ref = decodeWireSync(ArtifactRef)({
      id: input.id,
      kind: input.kind,
      mediaType: input.mediaType,
      digest: actual.digest,
      bytes: actual.bytes,
    });
    return await db.publish(scope.owner, input, key, ref, scope.prefix);
  } finally {
    if (!input.body.locked) await input.body.cancel().catch(() => undefined);
  }
}
