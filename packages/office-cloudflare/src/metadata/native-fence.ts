import type { WritePermit, FrozenReview, OwnerScope } from "@starter/office-server/ports";
import { decodeWireSync } from "@starter/office-contract";
import type { MetadataStore } from "./store.ts";
import { canonical, invalid, sqlNow } from "./store.ts";
import { Permit } from "./schemas.ts";

export interface PredicateSQL {
  readonly sql: string;
  readonly values: readonly (string | number | null)[];
}
export function permitSQL(
  db: MetadataStore,
  input: WritePermit,
  options: { readonly head?: number | null; readonly generation?: number | null } = {},
): PredicateSQL {
  const permit = decodeWireSync(Permit)(input);
  if (
    canonical(permit.owner) !== canonical(permit.target.owner) ||
    permit.documentId !== permit.target.documentId ||
    permit.authorityEpoch < 1 ||
    permit.serviceEpoch < 1
  )
    throw invalid();
  const owner = db.owner(permit.owner);
  const scope = db.native(permit.owner, permit.documentId, permit.target.unitId);
  const clauses = [
    `EXISTS(SELECT 1 FROM office_native_authority WHERE scope=? AND epoch=? AND command_id=? AND step_id=?)`,
    `EXISTS(SELECT 1 FROM office_meta_documents WHERE owner=? AND id=? AND unit=?)`,
  ];
  const values: (string | number | null)[] = [
    scope,
    permit.authorityEpoch,
    permit.operationId,
    permit.stepId,
    owner,
    permit.documentId,
    permit.target.unitId,
  ];
  const head = options.head === undefined ? permit.expectedHead : options.head;
  if (permit.target.scope.kind === "main") {
    clauses.push(
      head === null
        ? "NOT EXISTS(SELECT 1 FROM office_native_units WHERE scope=?)"
        : "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND head=? AND lifecycle='active')",
    );
    values.push(scope, ...(head === null ? [] : [head]));
  } else {
    const generation =
      options.generation === undefined ? permit.expectedGeneration : options.generation;
    if (generation === null) throw invalid();
    clauses.push(`EXISTS(SELECT 1 FROM office_meta_drafts m JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree
      LEFT JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
      WHERE m.owner=? AND m.id=? AND m.document=? AND w.generation=? AND ${head === null ? "d.head IS NULL" : "d.head=?"})`);
    values.push(
      scope,
      owner,
      permit.target.scope.draftId,
      permit.documentId,
      generation,
      ...(head === null ? [] : [head]),
    );
  }
  return { sql: clauses.join(" AND "), values };
}
export function frozenSQL(db: MetadataStore, review: FrozenReview): PredicateSQL {
  const owner = db.owner(review.owner);
  const scope = db.native(review.owner, review.documentId, review.unitId);
  const sql = `EXISTS(SELECT 1 FROM office_meta_drafts m JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree
    JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
    WHERE m.owner=? AND m.document=? AND m.worktree=? AND m.generation=? AND w.generation=? AND w.status='ready'
    AND d.head=? AND d.ready=? AND d.baseline IS ? AND d.source=? AND d.removed=?)
    AND ${
      review.mainRevision === null
        ? "NOT EXISTS(SELECT 1 FROM office_native_units WHERE scope=?)"
        : "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND head=? AND lifecycle='active')"
    }
    AND ?>${sqlNow}
    AND NOT EXISTS(SELECT 1 FROM office_meta_writes WHERE owner=? AND document=? AND phase IN ('staged','dispatching','unknown'))`;
  return {
    sql,
    values: [
      scope,
      owner,
      review.documentId,
      review.worktreeId,
      review.generation,
      review.generation,
      review.draftRevision,
      review.readyRevision,
      review.baselineRevision,
      review.source,
      Number(review.removed),
      scope,
      ...(review.mainRevision === null ? [] : [review.mainRevision]),
      review.expiresAt,
      owner,
      review.documentId,
    ],
  };
}
export function noBarrier(db: MetadataStore, owner: OwnerScope, documentId: string): PredicateSQL {
  return {
    sql: "NOT EXISTS(SELECT 1 FROM office_meta_barriers WHERE owner=? AND document=?)",
    values: [db.owner(owner), documentId],
  };
}
