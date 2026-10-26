import { operationRecordSql } from "../legacy-failure.ts";
import type { ArtifactRef } from "@starter/office-contract";
import type {
  IsolatedJob,
  JobRecord,
  OperationRecord,
  ViewRecord,
} from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import type { PredicateSQL } from "../native-fence.ts";
import { canonical, conflict, invalid, sqlNow } from "../store.ts";
import { operationRow } from "../operations.ts";
import { OperationRow } from "../schemas.ts";
import { validateOperation } from "../operation-policy.ts";
import { activeView, storedView } from "../sessions/views.ts";
import { nativeTypes, viewSQL } from "../sessions/fence.ts";

function matchView(job: IsolatedJob, view: ViewRecord): void {
  const b = job.binding,
    scope = view.target.scope;
  if (
    b.documentId !== view.view.documentId ||
    b.unitId !== view.target.unitId ||
    b.kind !== view.view.kind ||
    b.baseRevision !== view.view.revision ||
    b.generation !== (scope.kind === "draft" ? scope.generation : null)
  )
    throw invalid();
}
function pinned(ref: ArtifactRef | null, expected: ArtifactRef, claiming: boolean): boolean {
  return ref === null ? !claiming : canonical(ref) === canonical(expected);
}
function operationMatch(record: JobRecord, op: OperationRecord, unitId: string): void {
  validateOperation(op);
  const { job } = record,
    b = job.binding,
    claiming = record.state.state === "running";
  if (
    canonical(op.owner) !== canonical(record.owner) ||
    op.documentId !== b.documentId ||
    unitId !== b.unitId ||
    op.policyVersion !== b.policyVersion ||
    op.receipt.operationId !== b.operationId ||
    (op.jobId !== null && op.jobId !== b.jobId) ||
    (claiming &&
      (op.jobId !== b.jobId ||
        !["input-pinned", "queued", "running"].includes(op.receipt.phase))) ||
    [
      "confirmed",
      "failed-before-submit",
      "execution-unknown",
      "needs-attention",
      "conflict",
      "cancelled-before-dispatch",
    ].includes(op.receipt.phase)
  )
    throw invalid();
  if (job.kind === "import" && op.intent.kind === "import-into") {
    if (
      canonical(op.intent.input.source) !== canonical(job.input) ||
      canonical(op.intent.input.options) !== canonical(job.options) ||
      op.intent.input.target.generation !== b.generation ||
      op.worktreeId === null ||
      !pinned(op.artifacts.source, job.input, claiming)
    )
      throw invalid();
  } else if (job.kind === "import") {
    if (
      op.intent.kind !== "create" ||
      op.intent.input.source.kind !== "office" ||
      op.intent.input.source.uploadId !== job.input.id ||
      canonical(op.intent.input.source.options) !== canonical(job.options) ||
      !pinned(op.artifacts.source, job.input, claiming)
    )
      throw invalid();
    if (
      op.intent.input.destination === "main"
        ? b.generation !== null || op.worktreeId !== null
        : b.generation !== 1 || op.worktreeId === null
    )
      throw invalid();
  } else {
    if (!pinned(op.artifacts.input, job.input, claiming)) throw invalid();
    if (job.kind === "execute") {
      if (
        op.intent.kind !== "execute" ||
        canonical(op.intent.input.target) !== canonical(job.target) ||
        op.intent.input.codeId !== job.code.id ||
        !pinned(op.artifacts.code, job.code, claiming) ||
        op.worktreeId === null
      )
        throw invalid();
    } else if (job.kind === "export") {
      if (
        op.intent.kind !== "export" ||
        canonical(op.intent.input.options) !== canonical(job.options)
      )
        throw invalid();
    } else if (job.kind === "render") {
      if (
        op.intent.kind !== "render" ||
        canonical(op.intent.input.selection) !== canonical(job.selection)
      )
        throw invalid();
    } else throw invalid();
  }
}
export async function jobBasis(db: MetadataStore, record: JobRecord): Promise<PredicateSQL> {
  const { job } = record,
    b = job.binding,
    key = db.owner(record.owner);
  const clauses = [
    "EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=? AND json_extract(record,'$.document.kind')=?)",
  ];
  const values: (string | number | null)[] = [key, b.documentId, b.unitId, b.kind];
  let viewId: string | null = null;
  if (job.kind === "inspect") viewId = job.viewId;
  else {
    const op = await operationRow(db, record.owner, b.operationId);
    if (!op) throw conflict("NOT_FOUND");
    const unitId =
      job.kind === "import" && op.intent.kind === "import-into"
        ? await db.hash([
            "office-import-source",
            1,
            record.owner.stage,
            record.owner.ownerId,
            b.operationId,
            job.input.digest,
          ])
        : op.unitId;
    if (job.kind === "import" && op.intent.kind === "import-into" && unitId === op.unitId)
      throw invalid();
    operationMatch(record, op, unitId);
    // Conversion identity is never the destination's document/native SQL scope.
    values[2] = op.unitId;
    if (job.kind === "import" && op.intent.kind === "create") {
      clauses.push(
        "EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND json_extract(record,'$.location')=?)",
      );
      values.push(
        key,
        b.documentId,
        op.intent.input.destination === "main" ? "reserved-main" : "draft",
      );
    }
    clauses.push(
      `EXISTS(SELECT 1 FROM office_meta_operations WHERE owner=? AND id=? AND ${operationRecordSql}=?)`,
    );
    values.push(key, b.operationId, db.encode(OperationRow, op));
    if (op.intent.kind === "export" || op.intent.kind === "render") viewId = op.intent.input.viewId;
    const target =
      job.kind === "execute"
        ? job.target
        : job.kind === "import" && op.intent.kind === "import-into"
          ? op.intent.input.target
          : null;
    if (target !== null) {
      clauses.push(`EXISTS(SELECT 1 FROM office_meta_drafts m JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree
        JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id WHERE m.owner=? AND m.id=? AND m.document=?
        AND m.worktree=? AND m.generation=? AND w.generation=? AND w.status='draft' AND d.removed=0 AND d.head${job.kind === "execute" ? ">=" : "="}? AND d.type=?)`);
      values.push(
        db.native(record.owner, b.documentId, op.unitId),
        key,
        target.draftId,
        b.documentId,
        op.worktreeId,
        b.generation,
        b.generation,
        target.expectedRevision,
        nativeTypes[b.kind],
      );
    }
    if (job.kind === "import" && b.generation !== null) {
      clauses.push(
        "EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND document=? AND worktree=? AND generation=?)",
      );
      values.push(key, b.documentId, op.worktreeId, b.generation);
    }
  }
  if (viewId !== null) {
    const view = await activeView(db, record.owner, viewId),
      stored = await storedView(db, record.owner, viewId);
    if (!view || !stored) throw conflict("NOT_FOUND");
    matchView(job, view);
    const fence = viewSQL(db, view, false);
    clauses.push(
      fence.sql,
      "EXISTS(SELECT 1 FROM office_meta_views WHERE owner=? AND id=? AND record=? AND expires>" +
        sqlNow +
        ")",
    );
    values.push(...fence.values, key, viewId, stored.record);
  }
  return { sql: clauses.join(" AND "), values };
}
