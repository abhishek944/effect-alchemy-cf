import { Schema } from "effect";
import type { NativeDatabase } from "./database.ts";
import { boundedID, NativeStorageError } from "./types.ts";
import { Natural, parseMetadata } from "./metadata-parse.ts";

const Receipt = Schema.Struct({
  action: Schema.String.check(Schema.isMaxLength(512)),
  fingerprint: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  epoch: Natural,
});
export type NativeStepReceipt = typeof Receipt.Type;
export interface NativeStepReceiptPage {
  readonly items: readonly NativeStepReceipt[];
  readonly next: string | null;
}
/** Metadata observation only. Empty/current pages do not prove quiescence or absence of an in-flight commit. */
export async function readStepReceipts(
  db: NativeDatabase,
  commandID: string,
  stepID: string,
  cursor: string | null = null,
  limit = 100,
): Promise<NativeStepReceiptPage> {
  boundedID(commandID);
  boundedID(stepID);
  if (
    (cursor !== null && cursor.length > 512) ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100
  ) {
    throw new NativeStorageError("LIMIT", "Invalid native receipt page");
  }
  const rows = await db.all<{ action: string; fingerprint: string; epoch: number }>(
    `SELECT action,fingerprint,epoch FROM office_native_receipts WHERE scope=? AND command_id=? AND step_id=?
      AND action>? ORDER BY action LIMIT ?`,
    [db.key, commandID, stepID, cursor ?? "", limit + 1],
  );
  const items = rows.slice(0, limit).map((row) => parseMetadata(Receipt, row));
  return { items, next: rows.length > limit ? (items.at(-1)?.action ?? null) : null };
}
