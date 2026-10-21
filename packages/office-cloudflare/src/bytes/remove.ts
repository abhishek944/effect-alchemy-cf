import { Count, Id, decodeWireSync } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { sqlNow } from "../metadata/store.ts";
import { MAX_ATTEMPTS, assertKey, unknownOutcome } from "./data.ts";
import type { ByteStore } from "./store.ts";

/** Claim a nonready tombstone in D1 BEFORE touching any R2 key. Exact ready-ref edges defeat the claim. */
export async function removeBytes(
  db: ByteStore,
  owner: OwnerScope,
  id: string,
  notBefore: number,
  signal: AbortSignal,
): Promise<void> {
  decodeWireSync(Id)(id);
  decodeWireSync(Count)(notBefore);
  const scope = await db.scope(owner);
  const database = db.options.database;
  const claim = await database
    .withSession("first-primary")
    .prepare(`
    UPDATE office_bytes_refs SET state='removing'
    WHERE owner=? AND id=? AND state IN ('pending','ready','removing') AND created<=${sqlNow}-?
      AND ${sqlNow}>=?
      AND NOT EXISTS(SELECT 1 FROM office_meta_artifact_edges WHERE owner=? AND artifact=?)
      AND NOT EXISTS(SELECT 1 FROM office_bytes_objects WHERE owner=? AND id=? AND state='writing' AND created>${sqlNow}-?)
    RETURNING key`)
    .bind(scope.owner, id, db.graceMs, notBefore, scope.owner, id, scope.owner, id, db.graceMs)
    .first<{ key: string }>();
  if (!claim) return;
  assertKey(scope.prefix, id, claim.key);
  // One call is bounded. Remaining recent/interrupted attempts keep the ref nonready for a later call.
  const objects = await db.all<{ key: string }>(
    `SELECT key FROM office_bytes_objects
    WHERE owner=? AND id=? AND created<=${sqlNow}-? ORDER BY key LIMIT ?`,
    [scope.owner, id, db.graceMs, MAX_ATTEMPTS],
  );
  for (const object of objects) {
    signal.throwIfAborted();
    assertKey(scope.prefix, id, object.key);
    const removing = await database
      .withSession("first-primary")
      .prepare(`
      UPDATE office_bytes_objects SET state=CASE WHEN state IN ('complete','settled','deleting') THEN 'deleting' ELSE 'cleanup' END
      WHERE key=? AND owner=? AND id=? AND created<=${sqlNow}-?
        AND EXISTS(SELECT 1 FROM office_bytes_refs WHERE owner=? AND id=? AND state='removing')
        AND NOT EXISTS(SELECT 1 FROM office_meta_artifact_edges WHERE owner=? AND artifact=?)
      RETURNING state`)
      .bind(object.key, scope.owner, id, db.graceMs, scope.owner, id, scope.owner, id)
      .first<{ state: string }>();
    if (!removing) continue;
    // Delete is idempotent. An uncertain response leaves deleting/removing, never ready.
    await db.options.bucket.delete(object.key);
    if (await db.options.bucket.head(object.key)) throw unknownOutcome();
    signal.throwIfAborted();
    // An absent head cannot prove an in-flight/uncertain PUT will not commit later.
    // Never erase this pass\'s uncertain marker, even if its writer settles concurrently.
    if (removing.state === "cleanup") continue;
    await database
      .prepare(`DELETE FROM office_bytes_objects WHERE key=? AND owner=? AND id=? AND state='deleting'
      AND EXISTS(SELECT 1 FROM office_bytes_refs WHERE owner=? AND id=? AND state='removing')
      AND NOT EXISTS(SELECT 1 FROM office_meta_artifact_edges WHERE owner=? AND artifact=?)`)
      .bind(object.key, scope.owner, id, scope.owner, id, scope.owner, id)
      .run();
  }
  // A single bounded immutable owner/ID record survives successful GC, never an ID-reuse opportunity.
  await database
    .prepare(`UPDATE office_bytes_refs SET state='removed' WHERE owner=? AND id=? AND state='removing'
    AND NOT EXISTS(SELECT 1 FROM office_meta_artifact_edges WHERE owner=? AND artifact=?)
    AND NOT EXISTS(SELECT 1 FROM office_bytes_objects WHERE owner=? AND id=?)`)
    .bind(scope.owner, id, scope.owner, id, scope.owner, id)
    .run();
  if ((await db.row(scope.owner, id))?.state === "removing") throw unknownOutcome();
}
