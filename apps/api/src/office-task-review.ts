import { Effect } from "effect";
import type { ArtifactRef, DraftTarget } from "@starter/office-contract";
import type {
  DraftRecord,
  FrozenReview,
  NativeTarget,
  OfficeMetadata,
  ViewRecord,
} from "@starter/office-server/ports";
import { reviewFingerprintInput } from "@starter/office-server/native-remote";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officePrivateDigest } from "./office-private-placement.ts";
import type { OfficeMetadataResponse } from "./office-metadata-dispatch.ts";

type Role = "main" | "baseline" | "draft" | "result";
export type OfficeTaskReview = {
  readonly review: FrozenReview;
  readonly draft: DraftRecord;
  readonly roles: readonly { readonly role: Role; readonly record: ViewRecord }[];
};
/** Pin only this actual persisted review's finite source graph after genuine Task selection. */
export async function readOfficeTaskReview(
  metadata: OfficeMetadata,
  review: FrozenReview,
  target: DraftTarget,
): Promise<OfficeTaskReview> {
  const run = Effect.runPromise;
  const draft = await run(metadata.draft(review.owner, target.draftId));
  const document = await run(metadata.document(review.owner, target.documentId));
  if (
    draft === null ||
    document === null ||
    !officeSame(draft.owner, review.owner) ||
    !officeSame(document.owner, review.owner) ||
    document.document.id !== review.documentId ||
    target.documentId !== review.documentId ||
    document.unitId !== review.unitId ||
    draft.documentId !== review.documentId ||
    draft.worktreeId !== review.worktreeId ||
    draft.generation !== review.generation ||
    target.generation !== review.generation ||
    target.expectedRevision !== review.draftRevision ||
    review.readyRevision !== review.draftRevision ||
    review.expiresAt <= Date.now() ||
    review.preview?.kind !== "native-preview" ||
    (await officePrivateDigest(reviewFingerprintInput(review))) !== review.fingerprint
  )
    throw officeDenied();
  const roles: { role: Role; record: ViewRecord }[] = [];
  for (const role of ["main", "baseline", "draft", "result"] as const) {
    const expected = review[role];
    if (expected === null) continue;
    const record = await run(metadata.view(review.owner, expected.id));
    const scope = record?.target.scope;
    const main = role === "main" || role === "baseline";
    if (
      record === null ||
      !officeSame(record.owner, review.owner) ||
      !officeSame(record.target.owner, review.owner) ||
      record.target.documentId !== review.documentId ||
      record.target.unitId !== review.unitId ||
      !officeSame(record.view, expected) ||
      record.view.kind !== document.document.kind ||
      record.view.mode !== "read-only" ||
      record.view.nativeTarget.kind !== "pinned-snapshot" ||
      record.view.nativeTarget.unitId !== review.unitId ||
      record.view.expiresAt < review.expiresAt ||
      record.view.expiresAt <= Date.now() ||
      record.source.kind !== "artifact" ||
      record.source.artifact.kind !== "native-preview" ||
      (main
        ? scope?.kind !== "main" ||
          expected.revision !== (role === "main" ? review.mainRevision : review.baselineRevision)
        : scope?.kind !== "draft" ||
          scope.draftId !== draft.id ||
          scope.generation !== review.generation) ||
      (role === "draft" && expected.revision !== review.draftRevision)
    )
      throw officeDenied();
    roles.push({ role, record });
  }
  if (
    !roles.some((entry) => entry.role === "draft") ||
    (review.main === null) !== (review.mainRevision === null) ||
    (review.baseline === null) !== (review.baselineRevision === null)
  )
    throw officeDenied();
  return { review, draft, roles };
}

/** Re-read the same immutable records/epochs, never renew a View or substitute current content. */
export async function officeTaskReviewGraph(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
): Promise<OfficeTaskReview | null> {
  const original = request.original;
  if (!("task" in original) || original.task.binding.review === undefined) return null;
  const graph = original.task.binding.review;
  await request.live();
  const latest = await Effect.runPromise(metadata.review(original.actor.owner, graph.review.id));
  if (!officeSame(latest, graph.review) || latest === null) throw officeDenied();
  const current = await readOfficeTaskReview(metadata, latest, {
    documentId: graph.draft.documentId,
    draftId: graph.draft.id,
    generation: graph.draft.generation,
    expectedRevision: graph.review.draftRevision,
  });
  if (!officeSame(current, graph)) throw officeDenied();
  const placement = await request.currentPlacement(graph.review.documentId);
  if (
    placement.state !== "live" ||
    placement.until <= Date.now() ||
    placement.unitId !== graph.review.unitId ||
    graph.roles.some(
      ({ record }) =>
        record.authorityEpoch !== placement.authorityEpoch ||
        record.serviceEpoch !== placement.serviceEpoch,
    )
  )
    throw officeDenied();
  await request.live();
  return graph;
}
export async function assertOfficeTaskReviewResult(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  response: OfficeMetadataResponse,
): Promise<void> {
  if (!("value" in response)) return;
  const graph = await officeTaskReviewGraph(metadata, request);
  if (graph === null) return;
  if (response.method === "metadata.review" && !officeSame(response.value, graph.review))
    throw officeDenied();
  if (
    response.method === "metadata.view" &&
    !graph.roles.some(({ record }) => officeSame(record, response.value))
  )
    throw officeDenied();
  if (
    response.method === "metadata.historicalViewTarget" &&
    !graph.roles.some(({ record }) => officeSame(record.target, response.value))
  )
    throw officeDenied();
}
export function officeTaskReviewArtifact(graph: OfficeTaskReview, ref: ArtifactRef): boolean {
  return (
    officeSame(graph.review.preview, ref) ||
    graph.roles.some(
      ({ record }) => record.source.kind === "artifact" && officeSame(record.source.artifact, ref),
    )
  );
}
export async function officeTaskReviewTarget(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  target: NativeTarget,
): Promise<boolean> {
  const graph = await officeTaskReviewGraph(metadata, request);
  return graph !== null && graph.roles.some(({ record }) => officeSame(record.target, target));
}
