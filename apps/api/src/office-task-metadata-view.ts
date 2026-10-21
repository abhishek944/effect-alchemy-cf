import { Effect } from "effect";
import type { FrozenReview, OfficeMetadata, ViewRecord } from "@starter/office-server/ports";
import type { OfficeTaskInvocation } from "./office-task-issuance.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import type { OfficeTaskAcknowledged } from "./office-task-metadata-record.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

/** Root's real provider acknowledgements, not an arbitrary artifact selector or decoded View. */
export async function assertOfficeTaskView(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  original: OfficeTaskInvocation,
  record: ViewRecord,
  acknowledged: OfficeTaskAcknowledged,
): Promise<void> {
  if (
    original.task.observeOnly ||
    !officeSame(record.owner, original.actor.owner) ||
    !officeSame(record.target.owner, original.actor.owner) ||
    record.target.documentId !== record.view.documentId ||
    record.view.expiresAt <= Date.now()
  )
    throw officeDenied();
  const document = await Effect.runPromise(metadata.document(record.owner, record.view.documentId));
  if (
    document === null ||
    document.unitId !== record.target.unitId ||
    document.document.kind !== record.view.kind
  )
    throw officeDenied();
  const bound = original.actor.target;
  if (request.command?.method === "office.ready") {
    const scope = record.target.scope;
    if (
      bound === null ||
      bound.documentId !== record.view.documentId ||
      (scope.kind === "draft" &&
        (scope.draftId !== bound.draftId || scope.generation !== bound.generation)) ||
      record.source.kind !== "artifact" ||
      record.source.artifact.kind !== "native-preview" ||
      !acknowledged(record.source.artifact) ||
      record.view.mode !== "read-only" ||
      record.view.nativeTarget.kind !== "pinned-snapshot" ||
      record.view.nativeTarget.unitId !== document.unitId
    )
      throw officeDenied();
    return;
  }
  if (
    request.command?.method !== "office.open" ||
    !officeSame(request.command.input, {
      documentId: record.target.documentId,
      scope: record.target.scope,
    })
  )
    throw officeDenied();
  if (bound !== null) {
    const scope = record.target.scope;
    const draft = await Effect.runPromise(metadata.draft(record.owner, bound.draftId));
    if (
      bound.documentId !== record.view.documentId ||
      scope.kind !== "draft" ||
      scope.draftId !== bound.draftId ||
      scope.generation !== bound.generation ||
      record.view.revision !== bound.expectedRevision ||
      record.source.kind !== "draft" ||
      record.source.revision !== bound.expectedRevision ||
      draft === null ||
      draft.generation !== bound.generation ||
      draft.worktreeId !== record.source.worktreeId
    )
      throw officeDenied();
  } else {
    const selected = original.task.binding.readView;
    if (
      selected === null ||
      selected.source.kind !== "core" ||
      record.source.kind !== "core" ||
      !officeSame(record.target, selected.target) ||
      record.source.revision !== selected.source.revision ||
      record.view.revision !== selected.view.revision
    )
      throw officeDenied();
  }
}

export async function assertOfficeTaskReview(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  original: OfficeTaskInvocation,
  review: FrozenReview,
  acknowledged: OfficeTaskAcknowledged,
): Promise<void> {
  const bound = original.actor.target;
  if (
    request.command?.method !== "office.ready" ||
    original.task.observeOnly ||
    bound === null ||
    !officeSame(review.owner, original.actor.owner) ||
    review.documentId !== bound.documentId ||
    review.generation !== bound.generation ||
    review.draftRevision !== bound.expectedRevision ||
    review.readyRevision !== bound.expectedRevision ||
    review.expiresAt <= Date.now() ||
    (review.preview !== null && !acknowledged(review.preview))
  )
    throw officeDenied();
  const draft = await Effect.runPromise(metadata.draft(review.owner, bound.draftId));
  const document = await Effect.runPromise(metadata.document(review.owner, review.documentId));
  if (
    draft === null ||
    document === null ||
    draft.worktreeId !== review.worktreeId ||
    draft.documentId !== review.documentId ||
    draft.generation !== bound.generation ||
    document.unitId !== review.unitId
  )
    throw officeDenied();
  for (const role of ["main", "baseline", "draft", "result"] as const) {
    const view = review[role];
    if (view === null) continue;
    const actual = await Effect.runPromise(metadata.view(review.owner, view.id));
    if (actual === null || !officeSame(actual.view, view) || actual.target.unitId !== review.unitId)
      throw officeDenied();
    await assertOfficeTaskView(metadata, request, original, actual, acknowledged);
    const scope = actual.target.scope;
    if (
      role === "main" || role === "baseline"
        ? scope.kind !== "main"
        : scope.kind !== "draft" ||
          scope.draftId !== bound.draftId ||
          scope.generation !== bound.generation
    )
      throw officeDenied();
  }
}
