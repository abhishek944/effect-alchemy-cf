import { operationRecordSql } from "./legacy-failure.ts";
import { Count, Id, decodeWireSync } from "@starter/office-contract";
import type { OfficeMetadata, OperationRecord, OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore, Statement } from "./store.ts";
import { canonical, conflict, invalid, missing, sqlNow, storeEffect } from "./store.ts";
import { OperationRow } from "./schemas.ts";
import { artifactEdges, completeRefs, operationRefs } from "./artifacts.ts";
import { operationTarget } from "./operation-target.ts";
import {
  initialDraftConflict,
  operationIdentity,
  validateAdvance,
  validateOperation,
} from "./operation-policy.ts";
import { eventStatement, operationEvent } from "./events.ts";

export async function operationRow(
  db: MetadataStore,
  owner: OwnerScope,
  id: string,
): Promise<OperationRecord | null> {
  decodeWireSync(Id)(id);
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_operations WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  return row ? db.decode(OperationRow, row.record) : null;
}
export function createOperations(
  db: MetadataStore,
): Pick<OfficeMetadata, "operation" | "reserveOperation" | "advanceOperation"> {
  return {
    operation: (owner, id) => storeEffect(() => operationRow(db, owner, id)),
    reserveOperation: (input) =>
      storeEffect(async () => {
        const record = db.decode(OperationRow, db.encode(OperationRow, input));
        validateOperation(record);
        const owner = db.owner(record.owner);
        const id = record.receipt.operationId;
        const previous = await operationRow(db, record.owner, id);
        if (previous) {
          if (canonical(operationIdentity(previous)) !== canonical(operationIdentity(record)))
            throw conflict();
          for (const key of ["source", "input", "code", "proposal"] as const)
            if (
              record.artifacts[key] !== null &&
              canonical(previous.artifacts[key]) !== canonical(record.artifacts[key])
            )
              throw conflict();
          if (record.jobId !== null && record.jobId !== previous.jobId) throw conflict();
          return previous;
        }
        if (
          record.receipt.phase !== "reserved" ||
          record.receipt.version > 1 ||
          record.receipt.acceptedRevision !== null
        )
          throw invalid();
        const refs = operationRefs(record);
        const complete = completeRefs(db, record.owner, refs),
          target = operationTarget(db, record);
        await db.write(
          `NOT EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=?)
        AND EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=?) AND ${complete.sql} AND ${target.sql}`,
          [
            owner,
            id,
            owner,
            record.documentId,
            record.unitId,
            ...complete.values,
            ...target.values,
          ],
          [
            [
              "INSERT INTO office_meta_operations(owner,id,document,version,phase,created,record) VALUES(?,?,?,?,?,?,?)",
              [
                owner,
                id,
                record.documentId,
                record.receipt.version,
                "reserved",
                record.createdAt,
                db.encode(OperationRow, record),
              ],
            ],
            ...artifactEdges(db, record.owner, "operation", id, refs),
            eventStatement(db, record.owner, operationEvent(record.documentId, id)),
          ],
        );
        return record;
      }),
    advanceOperation: (input, expected) =>
      storeEffect(async () => {
        decodeWireSync(Count)(expected);
        const record = db.decode(OperationRow, db.encode(OperationRow, input));
        const owner = db.owner(record.owner);
        const id = record.receipt.operationId;
        const previous = await operationRow(db, record.owner, id);
        if (!previous) throw missing();
        if (canonical(previous) === canonical(record)) return previous;
        validateAdvance(previous, record, expected);
        const refs = operationRefs(record);
        const complete = completeRefs(db, record.owner, refs);
        let predicate = `EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND version=?
        AND (claim_worker IS NULL OR (claim_worker=? AND claim_until>${sqlNow}) OR (claim_until<=${sqlNow} AND phase<>'queued'))) AND ${complete.sql}`;
        const values: (string | number | null)[] = [
          owner,
          id,
          expected,
          db.workerId,
          ...complete.values,
        ];
        if (initialDraftConflict(previous, record)) {
          predicate += ` AND EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND phase='reserved' AND ${operationRecordSql}=?)
            AND NOT EXISTS(SELECT 1 FROM office_meta_jobs WHERE owner=? AND operation=?)
            AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=?)`;
          values.push(owner, id, db.encode(OperationRow, previous), owner, id, owner, id);
        }
        if (record.receipt.phase === "queued" && previous.receipt.phase !== "queued") {
          predicate +=
            " AND (SELECT count(*) FROM office_meta_operations WHERE owner=? AND document=? AND phase='queued')<?";
          values.push(owner, record.documentId, db.limits.queueDepth);
        }
        if (["cancelled-before-dispatch", "failed-before-submit"].includes(record.receipt.phase)) {
          predicate +=
            " AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? AND phase IN ('dispatching','unknown','confirmed'))";
          values.push(owner, id);
        }
        if (
          ["failed-before-submit", "cancelled-before-dispatch", "conflict"].includes(
            record.receipt.phase,
          )
        ) {
          predicate +=
            " AND NOT EXISTS(SELECT 1 FROM office_meta_approvals WHERE owner=? AND id=?)";
          values.push(owner, id);
        }
        if (["confirmed", "conflict"].includes(record.receipt.phase)) {
          predicate += ` AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? AND phase IN (${record.receipt.phase === "conflict" ? "'dispatching','unknown','confirmed'" : "'dispatching','unknown'"}))`;
          values.push(owner, id);
        }
        if (record.receipt.acceptedRevision !== null) {
          predicate +=
            " AND EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND operation=? AND phase='confirmed' AND accepted_revision=?)";
          values.push(owner, id, record.receipt.acceptedRevision);
        }
        const terminal = [
          "confirmed",
          "failed-before-submit",
          "conflict",
          "cancelled-before-dispatch",
        ].includes(record.receipt.phase);
        if (terminal) {
          predicate +=
            " AND NOT EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=? AND operation=?)";
          values.push(owner, record.documentId, id);
        }
        // Queue leases cover acknowledged handoff, not job lifetime. Historical
        // expired post-queue rows reconcile only through the existing version CAS;
        // the phase policy forbids returning them to queued/source dispatch.
        const releaseClaim = terminal || record.receipt.phase !== "queued";
        const cleanup: Statement[] = terminal
          ? [
              [
                "UPDATE office_meta_writes SET phase='failed',record=json_set(record,'$.phase','failed') WHERE owner=? AND operation=? AND phase='staged' AND json_extract(record,'$.preparedReceipt') IS NULL",
                [owner, id],
              ],
            ]
          : [];
        await db.write(predicate, values, [
          [
            `UPDATE office_meta_operations SET version=?,phase=?,record=?,claim_worker=CASE WHEN ? THEN NULL ELSE claim_worker END,
         claim_until=CASE WHEN ? THEN NULL ELSE claim_until END WHERE owner=? AND id=?`,
            [
              record.receipt.version,
              record.receipt.phase,
              db.encode(OperationRow, record),
              Number(releaseClaim),
              Number(releaseClaim),
              owner,
              id,
            ],
          ],
          ...cleanup,
          ...artifactEdges(db, record.owner, "operation", id, refs),
          eventStatement(db, record.owner, operationEvent(record.documentId, id)),
        ]);
        return record;
      }),
  };
}
