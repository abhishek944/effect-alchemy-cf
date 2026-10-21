import { ArtifactRef, Id, decodeWireSync } from "@starter/office-contract";
import type { ArtifactRef as Ref } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { assertKey, missingContent, unknownOutcome } from "./data.ts";
import type { ByteStore } from "./store.ts";
import { verifiedBody } from "./stream.ts";

export async function getBytes(
  db: ByteStore,
  owner: OwnerScope,
  id: string,
): Promise<{ ref: Ref; body: ReadableStream<Uint8Array> } | null> {
  decodeWireSync(Id)(id);
  const scope = await db.scope(owner);
  const row = await db.row(scope.owner, id);
  if (!row || row.state === "removed" || row.state === "removing") return null;
  if (row.state !== "ready") throw unknownOutcome();
  const ref = db.decode(ArtifactRef, row.record);
  if (ref.id !== id) throw missingContent();
  assertKey(scope.prefix, id, row.key);
  const indexed = await db.object(scope.owner, id, row.key);
  if (
    !indexed ||
    indexed.state !== "complete" ||
    indexed.digest !== ref.digest ||
    indexed.bytes !== ref.bytes ||
    !indexed.etag
  )
    throw missingContent();
  const object = await db.options.bucket.get(row.key);
  if (!object) throw missingContent();
  try {
    if (
      object.key !== row.key ||
      object.size !== ref.bytes ||
      object.etag !== indexed.etag ||
      object.customMetadata?.scope !== scope.prefix ||
      object.customMetadata.id !== id ||
      object.httpMetadata?.contentType !== ref.mediaType
    )
      throw missingContent();
    const current = await db.row(scope.owner, id);
    if (
      !current ||
      current.state !== "ready" ||
      current.key !== row.key ||
      current.record !== row.record
    )
      throw missingContent();
    return { ref, body: verifiedBody(object.body, ref.bytes, ref.digest) };
  } catch (cause) {
    await object.body.cancel().catch(() => undefined);
    throw cause;
  }
}
