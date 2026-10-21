import { Schema } from "effect";
import type { NativeDatabase } from "./database.ts";
import type { NativeAdmission, NativeFence, NativePieceRef } from "./types.ts";
import { digest, NativeStorageError } from "./types.ts";
import { NativeName, Natural, objectFields, parseMetadata } from "./metadata-parse.ts";
import { nativeAdmissionFence } from "../metadata/coordinator/fence.ts";

const Admission = Schema.Struct({
  turnId: NativeName,
  fence: Natural.check(Schema.isGreaterThanOrEqualTo(1)),
  authorizationDigest: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  notAfter: Natural.check(Schema.isGreaterThanOrEqualTo(1)),
});
export function captureNativeAdmission(input: NativeAdmission): NativeAdmission {
  return Object.freeze(
    parseMetadata(
      Admission,
      objectFields(input, ["turnId", "fence", "authorizationDigest", "notAfter"]),
    ),
  );
}
export function capturedAdmissionFence(db: NativeDatabase, effect: "read" | "stage") {
  const access = db.admission;
  if (!access) throw new NativeStorageError("SCOPE", "Strict native admission is required");
  const fence = db.fence;
  return nativeAdmissionFence(db.key, access, fence.commandID, fence.stepID, fence.epoch, effect);
}
export async function assertNativeAdmission(
  db: NativeDatabase,
  effect: "read" | "stage",
): Promise<void> {
  db.check();
  if (!db.admission) return; // Explicit low-level SDK-only construction, not strict concrete composition.
  const condition = capturedAdmissionFence(db, effect);
  const row = await db.resources.database
    .withSession("first-primary")
    .prepare(`SELECT 1 WHERE ${condition.sql}`)
    .bind(...condition.values)
    .first();
  db.check();
  if (!row) throw new NativeStorageError("FENCE", "Native admission expired, revoked or changed");
}
/** Existing exact native basis remains conjunctive; extracted only for the200-line DB budget. */
export function nativeWriteBasis(key: string, fence: NativeFence) {
  const { epoch, commandID, stepID, main, draft } = fence;
  const conditions = [
    "EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=? AND command_id=? AND step_id=?)",
  ];
  const bindings: (string | number | null)[] = [key, epoch, commandID, stepID];
  conditions.push(
    main
      ? "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND head=? AND lifecycle=?)"
      : "NOT EXISTS(SELECT 1 FROM office_native_units WHERE scope=?)",
  );
  bindings.push(key, ...(main ? [main.head, main.lifecycle] : []));
  if (draft) {
    conditions.push(`EXISTS(SELECT 1 FROM office_native_worktrees w LEFT JOIN office_native_drafts d
      ON d.scope=w.scope AND d.worktree=w.id WHERE w.scope=? AND w.id=? AND w.generation=?
      AND w.status=? AND COALESCE(d.head,0)=? AND COALESCE(d.removed,0)=?)`);
    bindings.push(
      key,
      draft.worktreeID,
      draft.generation,
      draft.status,
      draft.head,
      Number(draft.removed),
    );
  }
  return { conditions, bindings };
}
export function publicationStatements(
  db: NativeDatabase,
  action: string,
  fingerprint: string,
  fence: NativeFence,
) {
  return [
    db.statement("INSERT INTO office_native_receipts VALUES(?,?,?,?,?,?)", [
      db.key,
      fence.commandID,
      fence.stepID,
      action,
      fingerprint,
      fence.epoch,
    ]),
    db.statement(
      "INSERT INTO office_native_outbox(scope,command_id,step_id,action,epoch) VALUES(?,?,?,?,?)",
      [db.key, fence.commandID, fence.stepID, action, fence.epoch],
    ),
  ];
}
export async function putAdmittedPiece(
  db: NativeDatabase,
  key: string,
  bytes: Uint8Array,
  hash: string,
): Promise<void> {
  await db.assertWriteAdmission();
  let object = await db.resources.bucket.put(key, bytes, {
    onlyIf: { etagDoesNotMatch: "*" },
    customMetadata: { sha256: hash, codec: "office-native-piece-1" },
  });
  await db.assertWriteAdmission();
  if (!object) {
    object = await db.resources.bucket.head(key);
    await db.assertWriteAdmission();
  }
  if (!object || object.size !== bytes.length || object.customMetadata?.sha256 !== hash)
    throw new NativeStorageError("CONTENT", "Incomplete immutable native piece");
}
export async function loadAdmittedPiece(
  db: NativeDatabase,
  ref: NativePieceRef,
): Promise<Uint8Array> {
  await db.assertReadable();
  const object = await db.resources.bucket.get(ref.key);
  await db.assertReadable();
  if (!object) throw new NativeStorageError("CONTENT", "Missing immutable native content");
  const bytes = new Uint8Array(await object.arrayBuffer());
  await db.assertReadable();
  if (bytes.length !== ref.bytes || (await digest(bytes)) !== ref.digest)
    throw new NativeStorageError("CONTENT", "Native digest mismatch");
  await db.assertReadable();
  return bytes;
}
