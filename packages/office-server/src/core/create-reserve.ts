import { Effect } from "effect";
import { decodeWire, type CreateDocument, type CreateDraft } from "@starter/office-contract";
import type {
  ActorClaims,
  DocumentRecord,
  DraftRecord,
  OfficeDependencies,
} from "../ports/index.ts";
import { sameOwner } from "./claims.ts";
import { metadataDigest, reserveOperation } from "./operations.ts";
import { StoredDocument, StoredDraft } from "./record-schemas.ts";
import { officeFailure } from "./failure.ts";

const creationIds = (actor: ActorClaims, operationId: string) => {
  // Opaque assigned IDs, not authority and not application/native aliases. Reservation makes them canonical.
  const key = metadataDigest(
    ["office-create-ids", 1, actor.owner.stage, actor.owner.ownerId, operationId],
    4096,
  );
  return {
    documentId: `doc_${key}`,
    unitId: `unit_${key}`,
    draftId: `draft_${key}`,
    worktreeId: `worktree_${key}`,
  };
};
const reserveDocument = Effect.fn("Office.reserveCreationDocument")(function* (
  deps: OfficeDependencies,
  proposed: DocumentRecord,
) {
  const raw = yield* deps.metadata.reserveDocument(proposed).pipe(
    Effect.catch((error) => {
      if (error.code !== "IDEMPOTENCY_CONFLICT" && error.code !== "NATIVE_CONFLICT")
        return Effect.fail(error);
      return deps.metadata
        .document(proposed.owner, proposed.document.id)
        .pipe(
          Effect.flatMap((value) => (value === null ? Effect.fail(error) : Effect.succeed(value))),
        );
    }),
  );
  const value = yield* decodeWire(StoredDocument)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (
    !sameOwner(value.owner, proposed.owner) ||
    value.originOperationId !== proposed.originOperationId ||
    value.document.id !== proposed.document.id ||
    value.unitId !== proposed.unitId ||
    value.document.kind !== proposed.document.kind ||
    value.document.title !== proposed.document.title
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", proposed.originOperationId));
  return value;
});
const reserveDraft = Effect.fn("Office.reserveCreationDraft")(function* (
  deps: OfficeDependencies,
  proposed: DraftRecord,
) {
  const raw = yield* deps.metadata.reserveDraft(proposed).pipe(
    Effect.catch((error) => {
      if (error.code !== "IDEMPOTENCY_CONFLICT" && error.code !== "NATIVE_CONFLICT")
        return Effect.fail(error);
      return deps.metadata
        .draft(proposed.owner, proposed.id)
        .pipe(
          Effect.flatMap((value) => (value === null ? Effect.fail(error) : Effect.succeed(value))),
        );
    }),
  );
  const value = yield* decodeWire(StoredDraft)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  if (
    !sameOwner(value.owner, proposed.owner) ||
    value.originOperationId !== proposed.originOperationId ||
    value.id !== proposed.id ||
    value.documentId !== proposed.documentId ||
    value.worktreeId !== proposed.worktreeId
  )
    return yield* Effect.fail(officeFailure("IDEMPOTENCY_CONFLICT", proposed.originOperationId));
  return value;
});
export const reserveCreation = Effect.fn("Office.reserveCreation")(function* (
  deps: OfficeDependencies,
  actor: ActorClaims,
  input: CreateDocument,
) {
  if (actor.capability === "draft-task" && input.destination !== "new-draft")
    return yield* Effect.fail(officeFailure("FORBIDDEN", input.operationId));
  const ids = creationIds(actor, input.operationId);
  const draftDestination = input.destination === "new-draft";
  const document = yield* reserveDocument(deps, {
    owner: actor.owner,
    document: {
      id: ids.documentId,
      kind: input.source.kind === "blank" ? input.source.documentKind : input.source.options.kind,
      title: input.title,
      revision: null,
      draftId: draftDestination ? ids.draftId : null,
    },
    unitId: ids.unitId,
    originOperationId: input.operationId,
    location: draftDestination ? "draft" : "reserved-main",
  });
  // The native provider and metadata reserveDraft contract both allocate generation 1 initially.
  const draft = draftDestination
    ? yield* reserveDraft(deps, {
        owner: actor.owner,
        id: ids.draftId,
        documentId: document.document.id,
        worktreeId: ids.worktreeId,
        generation: 1,
        originOperationId: input.operationId,
      })
    : null;
  return yield* reserveOperation(deps, actor, { kind: "create", input }, document, draft);
});
export const reserveBranch = Effect.fn("Office.reserveBranch")(function* (
  deps: OfficeDependencies,
  actor: ActorClaims,
  input: CreateDraft,
  document: DocumentRecord,
) {
  const ids = creationIds(actor, input.operationId);
  const draft = yield* reserveDraft(deps, {
    owner: actor.owner,
    id: ids.draftId,
    documentId: document.document.id,
    worktreeId: ids.worktreeId,
    generation: 1,
    originOperationId: input.operationId,
  });
  return yield* reserveOperation(deps, actor, { kind: "create-draft", input }, document, draft);
});
