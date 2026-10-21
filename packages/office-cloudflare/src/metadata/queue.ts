import { OfficeConflict, OfficeForbidden, safeFailure } from "@starter/office-contract";
import type { OfficeMetadata, OperationRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "./store.ts";
import { invalid, sqlNow, storeEffect } from "./store.ts";
import { OperationRow } from "./schemas.ts";
import { eventStatement, operationEvent } from "./events.ts";

const activeOperation = `((claim_worker IS NOT NULL AND claim_until>${sqlNow}) OR phase IN
  ('running','admitted','dispatching','submission-unknown','publishing','execution-unknown','needs-attention'))`;
export function createQueue(db: MetadataStore): Pick<OfficeMetadata, "claimQueued"> {
  return {
    claimQueued: (workerId, limit, until) =>
      storeEffect(async () => {
        const now = Date.now();
        if (!db.workerId || workerId !== db.workerId)
          throw new OfficeForbidden(safeFailure("FORBIDDEN"));
        if (
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 32 ||
          !Number.isSafeInteger(until) ||
          until <= now ||
          until > now + db.limits.jobSeconds * 1000
        )
          throw invalid();
        const rows = await db.all<{ owner: string; id: string; version: number; record: string }>(
          `SELECT q.owner,q.id,q.version,q.record FROM office_meta_operations q WHERE json_extract(q.owner,'$[0]')=?
       AND q.phase='queued' AND (q.claim_until IS NULL OR q.claim_until<=${sqlNow})
       AND (SELECT count(*) FROM office_meta_operations WHERE owner=q.owner AND document=q.document AND id<>q.id AND ${activeOperation})<?
       ORDER BY q.created,q.owner,q.id LIMIT ?`,
          [db.options.stage, db.limits.jobsPerDocument, limit * 2],
        );
        const claimed: OperationRecord[] = [];
        for (const row of rows) {
          if (claimed.length >= limit) break;
          const previous = db.decode(OperationRow, row.record);
          const result = {
            ...previous,
            updatedAt: now,
            receipt: { ...previous.receipt, version: previous.receipt.version + 1 },
          };
          try {
            await db.write(
              `EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND version=? AND phase='queued'
          AND (claim_until IS NULL OR claim_until<=${sqlNow})) AND ?>${sqlNow}
          AND (SELECT count(*) FROM office_meta_operations WHERE owner=? AND document=? AND id<>?
            AND ${activeOperation})<?`,
              [
                row.owner,
                row.id,
                row.version,
                until,
                row.owner,
                previous.documentId,
                row.id,
                db.limits.jobsPerDocument,
              ],
              [
                [
                  "UPDATE office_meta_operations SET version=?,record=?,claim_worker=?,claim_until=? WHERE owner=? AND id=?",
                  [
                    result.receipt.version,
                    db.encode(OperationRow, result),
                    workerId,
                    until,
                    row.owner,
                    row.id,
                  ],
                ],
                eventStatement(db, previous.owner, operationEvent(previous.documentId, row.id)),
              ],
              "BUSY",
            );
            claimed.push(result);
          } catch (cause) {
            if (!(cause instanceof OfficeConflict) || cause.code !== "BUSY") throw cause;
          }
        }
        return claimed;
      }),
  };
}
