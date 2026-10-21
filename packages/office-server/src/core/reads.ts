import { Clock, Effect } from "effect";
import { Document, DocumentPage, Draft, DraftPage, decodeWire } from "@starter/office-contract";
import type { Actor, DraftRecord, OfficeDependencies, OwnerScope } from "../ports/index.ts";
import { authorize } from "./claims.ts";
import { boundedMetadataDigest, metadataDigest } from "./operations.ts";
import { nativeCall, officeFailure } from "./failure.ts";

const TOOL_PAGE_BYTES = 12 * 1024;
export const reviewKey = (
  owner: OwnerScope,
  documentId: string,
  draftId: string,
  generation: number,
  readyRevision: number,
): string =>
  metadataDigest(
    {
      stage: owner.stage,
      owner: owner.ownerId,
      document: documentId,
      draft: draftId,
      generation,
      revision: readyRevision,
    },
    4096,
  );
export const reviewIdentity = (draft: DraftRecord, readyRevision: number): string =>
  reviewKey(draft.owner, draft.documentId, draft.id, draft.generation, readyRevision);
export const readDraft = Effect.fn("Office.readDraft")(function* (
  deps: OfficeDependencies,
  actor: Actor,
  draftId: string,
) {
  const claims = yield* authorize(deps, actor, "discover", null);
  const record = yield* deps.metadata.draft(claims.owner, draftId);
  if (record === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const document = yield* deps.metadata.document(claims.owner, record.documentId);
  if (document === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
  const target = {
    owner: claims.owner,
    documentId: record.documentId,
    unitId: document.unitId,
    scope: { kind: "draft" as const, draftId: record.id, generation: record.generation },
  };
  const epochs = yield* deps.authority.current(claims.owner, record.documentId);
  const aggregate = yield* Effect.scoped(
    Effect.gen(function* () {
      const pair = yield* deps.native({ kind: "read", target, ...epochs });
      return yield* nativeCall(() =>
        pair.worktrees.getWorktree(
          {
            userID: claims.owner.ownerId,
            customData: {},
            request: { worktreeID: record.worktreeId },
          },
          record.worktreeId,
        ),
      );
    }),
  );
  const unit = aggregate?.units.find((item) => item.unitID === document.unitId);
  if (!unit || !aggregate) return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  const review =
    unit.readyDraftHeadRevision === undefined
      ? null
      : yield* deps.metadata.review(
          claims.owner,
          reviewIdentity(record, unit.readyDraftHeadRevision),
        );
  const barrier = yield* deps.metadata.publicationBarrier(claims.owner, record.documentId);
  return yield* decodeWire(Draft)({
    id: record.id,
    documentId: record.documentId,
    generation: record.generation,
    status: aggregate.worktree.status,
    reviewId: review?.id ?? null,
    publication:
      barrier?.state === "attention"
        ? "attention"
        : barrier
          ? "pending"
          : aggregate.worktree.status === "merged"
            ? "complete"
            : "none",
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED")));
});
export const makeOfficeReads = (deps: OfficeDependencies) => ({
  list: Effect.fn("Office.list")(function* (actor: Actor, cursor: string | null) {
    const claims = yield* authorize(deps, actor, "discover", null);
    const records = yield* deps.metadata.documents(claims.owner, cursor);
    const page = yield* decodeWire(DocumentPage)({
      items: records.items.map((row) => row.document),
      next: records.next,
    }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED")));
    // Provider pagination must fit this budget. Never slice/drop items and claim completion.
    yield* boundedMetadataDigest(page, TOOL_PAGE_BYTES);
    return page;
  }),
  document: Effect.fn("Office.document")(function* (actor: Actor, id: string) {
    const claims = yield* authorize(deps, actor, "discover", null);
    const record = yield* deps.metadata.document(claims.owner, id);
    if (record === null) return yield* Effect.fail(officeFailure("NOT_FOUND"));
    return yield* decodeWire(Document)(record.document).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
  }),
  draft: (actor: Actor, id: string) => readDraft(deps, actor, id),
  drafts: Effect.fn("Office.drafts")(function* (actor: Actor, cursor: string | null) {
    const claims = yield* authorize(deps, actor, "discover", null);
    const records = yield* deps.metadata.drafts(claims.owner, cursor);
    const items: Draft[] = [];
    for (const record of records.items) items.push(yield* readDraft(deps, actor, record.id));
    const page = yield* decodeWire(DraftPage)({ items, next: records.next }).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
    yield* boundedMetadataDigest(page, TOOL_PAGE_BYTES);
    return page;
  }),
  events: Effect.fn("Office.events")(function* (actor: Actor, documentId: string, after: number) {
    const claims = yield* authorize(deps, actor, "discover", null);
    const document = yield* deps.metadata.document(claims.owner, documentId);
    if (!document) return yield* Effect.fail(officeFailure("NOT_FOUND"));
    const page = yield* deps.metadata.events(claims.owner, documentId, after);
    const now = yield* Clock.currentTimeMillis;
    if (claims.expiresAt <= now) return yield* Effect.fail(officeFailure("UNAUTHENTICATED"));
    return { ...page, gap: page.items.length > 0 && page.items[0]?.sequence !== after + 1 };
  }),
});
