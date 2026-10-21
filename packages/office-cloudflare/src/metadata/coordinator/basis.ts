import type { NativeTarget, SerialAdmission } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import type { PredicateSQL } from "../native-fence.ts";
import type { Turn } from "./types.ts";

/** Only native admission consults CURRENT native basis. Proof retains its original target instead. */
export function admissionBasis(
  db: MetadataStore,
  target: NativeTarget,
  request: SerialAdmission,
  plan: Turn["nativePlan"],
): PredicateSQL {
  if (request.purpose !== "native") return { sql: "1", values: [] };
  const owner = db.owner(target.owner),
    scope = db.native(target.owner, target.documentId, target.unitId);
  const birth = `EXISTS(SELECT 1 FROM office_meta_operations o WHERE o.owner=? AND o.id=?
    AND json_extract(o.record,'$.intent.kind') IN ('create','create-draft'))`;
  if (target.scope.kind === "main")
    return request.expectedHead === null
      ? {
          sql: `${birth} AND NOT EXISTS(SELECT 1 FROM office_native_units WHERE scope=?)`,
          values: [owner, request.operationId, scope],
        }
      : {
          sql: "EXISTS(SELECT 1 FROM office_native_units WHERE scope=? AND head=? AND lifecycle='active')",
          values: [scope, request.expectedHead],
        };
  const values: (string | number | null)[] = [
    owner,
    target.scope.draftId,
    target.documentId,
    target.scope.generation,
  ];
  const metadata =
    "EXISTS(SELECT 1 FROM office_meta_drafts WHERE owner=? AND id=? AND document=? AND generation=?)";
  if (request.expectedHead === null && plan !== "newborn-unit")
    return {
      sql: `${metadata} AND ${birth} AND NOT EXISTS(SELECT 1 FROM office_native_worktrees w
      JOIN office_meta_drafts m ON m.worktree=w.id AND m.owner=? AND m.id=? WHERE w.scope=?)`,
      values: [...values, owner, request.operationId, owner, target.scope.draftId, scope],
    };
  return {
    sql: `${metadata} AND EXISTS(SELECT 1 FROM office_meta_drafts m
      JOIN office_native_worktrees w ON w.scope=? AND w.id=m.worktree
      LEFT JOIN office_native_drafts d ON d.scope=w.scope AND d.worktree=w.id
      WHERE m.owner=? AND m.id=? AND m.document=? AND w.generation=? AND d.head IS ?)`,
    values: [
      ...values,
      scope,
      owner,
      target.scope.draftId,
      target.documentId,
      target.scope.generation,
      request.expectedHead,
    ],
  };
}
