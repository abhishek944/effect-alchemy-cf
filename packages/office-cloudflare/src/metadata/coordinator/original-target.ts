import type { NativeTarget, OperationRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { canonical, conflict } from "../store.ts";
import { readView } from "../sessions/views.ts";
import { reviewRow } from "../reviews.ts";
import { ApprovalRow, WriteRow } from "../schemas.ts";

/** Original control identity only. Never materializes native data or renews an expired View. */
export async function requireOriginalTarget(
  db: MetadataStore,
  operation: OperationRecord,
  target: NativeTarget,
): Promise<void> {
  if (
    canonical(operation.owner) !== canonical(target.owner) ||
    operation.documentId !== target.documentId ||
    operation.unitId !== target.unitId
  )
    throw conflict("FORBIDDEN");
  const intent = operation.intent;
  if (intent.kind === "execute" || intent.kind === "import-into") {
    if (
      canonical(target.scope) !==
      canonical({
        kind: "draft",
        draftId: intent.input.target.draftId,
        generation: intent.input.target.generation,
      })
    )
      throw conflict("FORBIDDEN");
    return;
  }
  if (intent.kind === "ready" || intent.kind === "reopen" || intent.kind === "discard") {
    if (
      canonical(target.scope) !==
      canonical({
        kind: "draft",
        draftId: intent.input.draftId,
        generation: intent.input.generation,
      })
    )
      throw conflict("FORBIDDEN");
    return;
  }
  if (intent.kind === "render" || intent.kind === "export") {
    const view = await readView(db, operation.owner, intent.input.viewId);
    if (!view || canonical(view.target) !== canonical(target)) throw conflict("CONTENT_REQUIRED");
    return;
  }
  if (operation.receipt.draftId === null) {
    if (target.scope.kind !== "main") throw conflict("FORBIDDEN");
    return;
  }
  if (target.scope.kind !== "draft" || target.scope.draftId !== operation.receipt.draftId)
    throw conflict("FORBIDDEN");
  if (intent.kind === "approve" || intent.kind === "merge") {
    const stored =
      intent.kind === "merge"
        ? await db.first<{ record: string }>(
            "SELECT record FROM office_meta_approvals WHERE owner=? AND id=?",
            [db.owner(operation.owner), intent.input.approvalOperationId],
          )
        : null;
    const approval = stored ? db.decode(ApprovalRow, stored.record) : null;
    const reviewId = intent.kind === "approve" ? intent.input.reviewId : approval?.reviewId;
    const review = reviewId ? await reviewRow(db, operation.owner, reviewId) : null;
    if (
      !review ||
      review.documentId !== operation.documentId ||
      review.unitId !== operation.unitId ||
      review.worktreeId !== operation.worktreeId ||
      review.generation !== target.scope.generation
    )
      throw conflict("CONTENT_REQUIRED");
    return;
  }
  const write = await db.first<{ record: string }>(
    "SELECT record FROM office_meta_writes WHERE owner=? AND operation=? ORDER BY id LIMIT 1",
    [db.owner(operation.owner), operation.receipt.operationId],
  );
  if (write) {
    const original = db.decode(WriteRow, write.record);
    if (
      original.generation !== target.scope.generation ||
      original.worktreeId !== operation.worktreeId
    )
      throw conflict("CONTENT_REQUIRED");
  } else {
    const draft = await db.first<{ generation: number; worktree: string }>(
      "SELECT generation,worktree FROM office_meta_drafts WHERE owner=? AND id=? AND document=?",
      [db.owner(operation.owner), target.scope.draftId, operation.documentId],
    );
    if (
      !draft ||
      draft.generation !== target.scope.generation ||
      draft.worktree !== operation.worktreeId
    )
      throw conflict("CONTENT_REQUIRED");
  }
}
