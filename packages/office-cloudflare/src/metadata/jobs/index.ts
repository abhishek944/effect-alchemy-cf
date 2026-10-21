import { Count, Id, decodeWireSync } from "@starter/office-contract";
import type { JobRecord, OfficeMetadata, OwnerScope } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { canonical, conflict, invalid, missing, sqlNow, storeEffect } from "../store.ts";
import { artifactEdges, completeRefs } from "../artifacts.ts";
import { JobRow } from "./schemas.ts";
import { jobRefs, terminal, validateAdvance, validateJob } from "./policy.ts";
import { jobBasis } from "./basis.ts";
export {
  jobSchemaStatements,
  JobRow,
  IsolatedJobRow,
  JobBindingRow,
  JobStateRow,
} from "./schemas.ts";

async function jobRow(db: MetadataStore, owner: OwnerScope, id: string): Promise<JobRecord | null> {
  decodeWireSync(Id)(id);
  const row = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_jobs WHERE owner=? AND id=?",
    [db.owner(owner), id],
  );
  if (!row) return null;
  const record = db.decode(JobRow, row.record);
  await validateJob(db, record);
  if (record.job.binding.jobId !== id || canonical(record.owner) !== canonical(owner))
    throw conflict();
  return record;
}
export function createJobMetadata(
  db: MetadataStore,
): Pick<OfficeMetadata, "reserveJob" | "job" | "advanceJob"> {
  return {
    job: (owner, id) => storeEffect(() => jobRow(db, owner, id)),
    reserveJob: (input) =>
      storeEffect(async () => {
        const record = db.decode(JobRow, db.encode(JobRow, input));
        await validateJob(db, record);
        if (
          record.version !== 0 ||
          record.state.state !== "queued" ||
          record.dispatch !== null ||
          record.updatedAt !== record.createdAt
        )
          throw invalid();
        const b = record.job.binding,
          key = db.owner(record.owner),
          id = b.jobId;
        const previous = await jobRow(db, record.owner, id);
        if (previous) {
          if (canonical(previous.job) !== canonical(record.job)) throw conflict();
          return previous;
        }
        const basis = await jobBasis(db, record),
          refs = jobRefs(record),
          ready = completeRefs(db, record.owner, refs);
        try {
          await db.write(
            `(${basis.sql}) AND (${ready.sql}) AND ?<=${sqlNow}
          AND NOT EXISTS(SELECT 1 FROM office_meta_jobs WHERE owner=? AND (id=? OR operation=?))
          AND (SELECT count(*) FROM office_meta_jobs WHERE owner=? AND document=? AND state='queued')<?`,
            [
              ...basis.values,
              ...ready.values,
              record.createdAt,
              key,
              id,
              b.operationId,
              key,
              b.documentId,
              db.limits.queueDepth,
            ],
            [
              [
                "INSERT INTO office_meta_jobs VALUES(?,?,?,?,?,?,?,?)",
                [
                  key,
                  id,
                  b.documentId,
                  b.operationId,
                  0,
                  "queued",
                  db.encode(JobRow, record),
                  await db.hash({ owner: record.owner, job: record.job }),
                ],
              ],
              ...artifactEdges(db, record.owner, "job", id, refs),
            ],
            "BUSY",
          );
        } catch (cause) {
          const old = await jobRow(db, record.owner, id);
          if (!old) throw cause;
          if (canonical(old.job) !== canonical(record.job)) throw conflict();
          return old;
        }
        return record;
      }),
    advanceJob: (input, expected) =>
      storeEffect(async () => {
        decodeWireSync(Count)(expected);
        const record = db.decode(JobRow, db.encode(JobRow, input));
        await validateJob(db, record);
        const b = record.job.binding,
          key = db.owner(record.owner),
          previous = await jobRow(db, record.owner, b.jobId);
        if (!previous) throw missing();
        if (terminal(previous) && canonical(previous) === canonical(record)) return previous;
        validateAdvance(previous, record, expected);
        const refs = jobRefs(record),
          ready = completeRefs(db, record.owner, refs);
        let sql = `EXISTS(SELECT 1 FROM office_meta_jobs WHERE owner=? AND id=? AND version=? AND record=?)
        AND (${ready.sql}) AND ?<=${sqlNow}`;
        const values: (string | number | null)[] = [
          key,
          b.jobId,
          expected,
          db.encode(JobRow, previous),
          ...ready.values,
          record.updatedAt,
        ];
        if (record.state.state === "running") {
          const dispatch = record.dispatch;
          if (!dispatch || (db.workerId !== null && dispatch.workerId !== db.workerId))
            throw invalid();
          const basis = await jobBasis(db, record);
          sql += ` AND (${basis.sql}) AND ?<=${sqlNow} AND ?>${sqlNow}
          AND (SELECT count(*) FROM office_meta_jobs WHERE owner=? AND document=? AND state='running')<?`;
          values.push(
            ...basis.values,
            dispatch.claimedAt,
            dispatch.deadlineAt,
            key,
            b.documentId,
            db.limits.jobsPerDocument,
          );
        } else if (record.state.state === "succeeded") {
          if (!record.dispatch) throw invalid();
          sql += ` AND ?>=${sqlNow}`;
          values.push(record.dispatch.deadlineAt);
        }
        // Never recover a failed/lost claim acknowledgement by rereading and returning an old running row.
        await db.write(
          sql,
          values,
          [
            [
              "UPDATE office_meta_jobs SET version=?,state=?,record=? WHERE owner=? AND id=?",
              [record.version, record.state.state, db.encode(JobRow, record), key, b.jobId],
            ],
            ...artifactEdges(db, record.owner, "job", b.jobId, refs),
          ],
          "STALE_BASIS",
        );
        return record;
      }),
  };
}
