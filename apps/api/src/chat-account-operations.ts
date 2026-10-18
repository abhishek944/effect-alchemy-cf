/**
 * Immutable host operation evidence for account commands.
 *
 * Prepared once before native admission and stored beside the existing send
 * record in one insert, so it can never be amended by a rejected, busy or
 * duplicated delivery. The intent is frozen here: the expected revision and any
 * Undo target are captured at preparation time and are never rebased from a later
 * read. Legacy rows without this evidence fail account mutation closed.
 */
import { Schema } from "effect";
import { decodeOption } from "./chat-internal.ts";
import { FrozenIntent } from "./theme-model.ts";

export const ACCOUNT_OPERATION_VERSION = 1;

export const AccountOperationRecord = Schema.Struct({
  version: Schema.Literal(ACCOUNT_OPERATION_VERSION),
  ownerId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  /** Conversation object scope the operation was prepared in. */
  chatScope: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  /** Native conversation id proven by the executing tool's own live lineage. */
  conversationId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
  intent: FrozenIntent,
});
export type AccountOperationRecord = typeof AccountOperationRecord.Type;

export type AccountOperationView = AccountOperationRecord & {
  readonly operationId: string;
  readonly identityHash: string;
};

export const decodeAccountOperation = (
  raw: string | null,
  context: { readonly operationId: string; readonly identityHash: string },
): AccountOperationView | null => {
  if (raw === null) return null;
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const record = decodeOption(AccountOperationRecord, parsed);
  if (record === null) return null;
  return { ...record, operationId: context.operationId, identityHash: context.identityHash };
};
