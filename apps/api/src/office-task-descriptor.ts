import { Effect } from "effect";
import type {
  DraftRecord,
  FrozenReview,
  NativeTarget,
  OfficeMetadata,
  OwnerScope,
  Page,
} from "@starter/office-server/ports";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officeTaskReviewGraph } from "./office-task-review.ts";
import type { OfficeMetadataResponse } from "./office-metadata-dispatch.ts";

export type OfficeTaskDiscovery = {
  readonly rows: readonly DraftRecord[];
  readonly page: Page<DraftRecord> | null;
  readonly draftId: string | null;
};
/** Exact actual provider page/row, request-local only; no filter after LIMIT or persistent mirror. */
export async function readOfficeTaskDiscovery(
  metadata: OfficeMetadata,
  owner: OwnerScope,
  selector: { draftId: string } | { cursor: string | null },
): Promise<OfficeTaskDiscovery> {
  const page =
    "cursor" in selector ? await Effect.runPromise(metadata.drafts(owner, selector.cursor)) : null;
  const row =
    "draftId" in selector ? await Effect.runPromise(metadata.draft(owner, selector.draftId)) : null;
  const rows = page?.items ?? (row === null ? [] : [row]);
  if (
    rows.length > 100 ||
    new Set(rows.map((draft) => draft.id)).size !== rows.length ||
    rows.some((draft) => !officeSame(draft.owner, owner) || draft.generation < 1)
  )
    throw officeDenied();
  return { rows, page, draftId: "draftId" in selector ? selector.draftId : null };
}
export function officeTaskDescriptorRequest(request: OfficePrivateRequest): boolean {
  return (
    "task" in request.original &&
    ["office.draft", "office.drafts", "office.review"].includes(request.command?.method ?? "")
  );
}
/** Only real current selected draft metadata may produce a descriptor-only native handle. */
export async function assertOfficeTaskDescriptor(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  target: NativeTarget,
): Promise<void> {
  const original = request.original;
  if (!("task" in original) || target.scope.kind !== "draft") throw officeDenied();
  const graph =
    original.task.binding.review === undefined
      ? null
      : await officeTaskReviewGraph(metadata, request);
  const rows = graph === null ? (original.task.binding.discovery?.rows ?? []) : [graph.draft];
  const scope = target.scope;
  const expected = rows.find((row) => row.id === scope.draftId);
  if (
    expected === undefined ||
    !officeSame(target.owner, original.actor.owner) ||
    expected.documentId !== target.documentId ||
    expected.generation !== scope.generation
  )
    throw officeDenied();
  const row = await Effect.runPromise(metadata.draft(target.owner, scope.draftId));
  const document = await Effect.runPromise(metadata.document(target.owner, target.documentId));
  if (
    !officeSame(row, expected) ||
    document === null ||
    !officeSame(document.owner, target.owner) ||
    document.document.id !== target.documentId ||
    document.unitId !== target.unitId
  )
    throw officeDenied();
  await request.live();
}
export async function assertOfficeTaskDescriptorResult(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  response: OfficeMetadataResponse,
): Promise<void> {
  const original = request.original;
  if (
    !("value" in response) ||
    !("task" in original) ||
    original.task.binding.discovery === undefined
  )
    return;
  const pin = original.task.binding.discovery;
  if (response.method === "metadata.drafts" && !officeSame(response.value, pin.page))
    throw officeDenied();
  if (response.method === "metadata.draft") {
    const expected = pin.rows.find((row) => row.id === response.value?.id) ?? null;
    if (!officeSame(response.value, expected)) throw officeDenied();
  }
  if (response.method === "metadata.review" && response.value !== null)
    await assertOfficeTaskDescriptorReview(metadata, request, response.value);
}
export async function assertOfficeTaskDescriptorReview(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  review: FrozenReview,
): Promise<void> {
  const original = request.original;
  if (!("task" in original)) throw officeDenied();
  const row = original.task.binding.discovery?.rows.find(
    (draft) =>
      draft.documentId === review.documentId &&
      draft.worktreeId === review.worktreeId &&
      draft.generation === review.generation,
  );
  if (row === undefined || !officeSame(review.owner, original.actor.owner)) throw officeDenied();
  const document = await Effect.runPromise(metadata.document(original.actor.owner, row.documentId));
  if (
    document === null ||
    !officeSame(document.owner, original.actor.owner) ||
    document.unitId !== review.unitId
  )
    throw officeDenied();
  await assertOfficeTaskDescriptor(metadata, request, {
    owner: row.owner,
    documentId: row.documentId,
    unitId: document.unitId,
    scope: { kind: "draft", draftId: row.id, generation: row.generation },
  });
}
