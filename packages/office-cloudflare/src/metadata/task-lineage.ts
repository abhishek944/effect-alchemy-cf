import { Schema } from "effect";
import { OfficeLimited, safeFailure } from "@starter/office-contract";
import { OriginalActorClaims } from "@starter/office-server/ports";
import type { OperationRecord, Store, TaskActor } from "@starter/office-server/ports";
import type { OfficeProviderOptions } from "./store.ts";
import { MetadataStore, canonical, invalid, storeEffect } from "./store.ts";
import { OperationRow } from "./schemas.ts";
import { validateOperation } from "./operation-policy.ts";

const fields = OriginalActorClaims.members[1].fields;
const Selector = Schema.Struct({
  owner: fields.owner,
  principalId: fields.principalId,
  sessionEpoch: fields.sessionEpoch.check(Schema.isGreaterThan(0)),
  acceptedInput: fields.acceptedInput,
});
type Selector = Pick<TaskActor, "owner" | "principalId" | "sessionEpoch" | "acceptedInput">;

/** Existing confirmed metadata ONLY. Caller first proves genuine private callback/fresh session.
 * IDs/epoch/schema are selectors, not authentication. Old actor expiry grants no renewed rights.
 */
export function readConfirmedTaskOperations(
  options: OfficeProviderOptions,
  input: Selector,
): Store<readonly OperationRecord[]> {
  const db = new MetadataStore(options);
  return storeEffect(async () => {
    const selected = db.decode(Selector, db.encode(Selector, input));
    const owner = db.owner(selected.owner);
    const accepted = selected.acceptedInput;
    if (selected.principalId !== selected.owner.ownerId) throw invalid();
    const rows = await db.all<{ id: string; record: string }>(
      `SELECT id,record FROM office_meta_operations WHERE owner=? AND phase='confirmed'
      AND json_extract(record,'$.actor.capability')='draft-task'
      AND json_extract(record,'$.actor.principalId')=?
      AND json_extract(record,'$.actor.sessionEpoch')=?
      AND json_extract(record,'$.actor.acceptedInput.requestId')=?
      AND json_extract(record,'$.actor.acceptedInput.submissionId')=?
      AND json_extract(record,'$.actor.acceptedInput.conversationId')=?
      AND json_extract(record,'$.actor.acceptedInput.digest')=?
      ORDER BY id LIMIT 129`,
      [
        owner,
        selected.principalId,
        selected.sessionEpoch,
        accepted.requestId,
        accepted.submissionId,
        accepted.conversationId,
        accepted.digest,
      ],
    );
    if (rows.length > 128) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
    return rows.map((row) => {
      const record = db.decode(OperationRow, row.record);
      validateOperation(record);
      const actor = record.actor;
      if (
        actor.capability !== "draft-task" ||
        db.owner(record.owner) !== owner ||
        canonical(actor.owner) !== canonical(selected.owner) ||
        actor.principalId !== selected.principalId ||
        actor.sessionEpoch !== selected.sessionEpoch ||
        actor.acceptedInput.requestId !== accepted.requestId ||
        actor.acceptedInput.submissionId !== accepted.submissionId ||
        actor.acceptedInput.conversationId !== accepted.conversationId ||
        actor.acceptedInput.digest !== accepted.digest ||
        record.receipt.phase !== "confirmed" ||
        record.receipt.operationId !== row.id
      )
        throw invalid();
      return record;
    });
  });
}
