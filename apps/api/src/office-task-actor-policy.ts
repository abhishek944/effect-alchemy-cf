import { Effect } from "effect";
import type {
  ActorVerification,
  NativeTarget,
  OfficeMetadata,
  OperationRecord,
} from "@starter/office-server/ports";
import type { OfficeTaskInvocation } from "./office-task-issuance.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { assertOfficeTaskCommand, assertOfficeTaskObservedIntent } from "./office-task-command.ts";
import { sameOfficeTaskInput } from "./office-task-lineage.ts";
import { officeTaskReviewTarget } from "./office-task-review.ts";

/** Current original Root registration only, never a decoded actor supplied by Node/model.
 * This is actor/target metadata policy, NOT serial head/native publication or file authority.
 */
export function officeTaskActorPolicy(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  original: OfficeTaskInvocation,
) {
  const { actor, task } = original;
  const live = Effect.tryPromise({ try: request.live, catch: officeDenied });
  const target = (input: NativeTarget, creation: OperationRecord | null = null) =>
    Effect.gen(function* () {
      if (!officeSame(input.owner, actor.owner)) return yield* Effect.fail(officeDenied());
      const document = yield* metadata.document(actor.owner, input.documentId);
      if (
        document === null ||
        !officeSame(document.owner, actor.owner) ||
        document.document.id !== input.documentId ||
        document.unitId !== input.unitId
      )
        return yield* Effect.fail(officeDenied());
      if (creation !== null) {
        if (
          input.scope.kind !== "draft" ||
          creation.receipt.draftId !== input.scope.draftId ||
          input.scope.generation !== 1
        )
          return yield* Effect.fail(officeDenied());
        const draft = yield* metadata.draft(actor.owner, input.scope.draftId);
        if (
          draft === null ||
          !officeSame(draft.owner, actor.owner) ||
          draft.id !== input.scope.draftId ||
          draft.originOperationId !== creation.receipt.operationId ||
          draft.documentId !== input.documentId ||
          draft.worktreeId !== creation.worktreeId ||
          draft.generation !== 1
        )
          return yield* Effect.fail(officeDenied());
        if (
          creation.intent.kind === "create" &&
          document.originOperationId !== creation.receipt.operationId
        )
          return yield* Effect.fail(officeDenied());
        if (
          creation.intent.kind === "create-draft" &&
          (task.binding.fork === null ||
            task.binding.fork.view.documentId !== input.documentId ||
            task.binding.fork.target.unitId !== input.unitId)
        )
          return yield* Effect.fail(officeDenied());
        return undefined;
      }
      if (
        yield* Effect.tryPromise({
          try: () => officeTaskReviewTarget(metadata, request, input),
          catch: officeDenied,
        })
      )
        return undefined;
      for (const selected of [task.binding.readView, task.binding.fork]) {
        if (selected === null || !officeSame(input, selected.target)) continue;
        const actual = yield* metadata.view(actor.owner, selected.view.id);
        if (
          actual === null ||
          actual.view.expiresAt <= Date.now() ||
          !officeSame(actual.target, selected.target) ||
          !officeSame(actual.source, selected.source) ||
          actual.view.revision !== selected.view.revision
        )
          return yield* Effect.fail(officeDenied());
        return undefined;
      }
      const bound = actor.target;
      if (
        bound === null ||
        bound.documentId !== input.documentId ||
        input.scope.kind !== "draft" ||
        input.scope.draftId !== bound.draftId ||
        input.scope.generation !== bound.generation
      )
        return yield* Effect.fail(officeDenied());
      const draft = yield* metadata.draft(actor.owner, bound.draftId);
      if (
        draft === null ||
        !officeSame(draft.owner, actor.owner) ||
        draft.documentId !== input.documentId ||
        draft.generation !== bound.generation
      )
        return yield* Effect.fail(officeDenied());
      return undefined;
    });
  return (input: ActorVerification) =>
    Effect.gen(function* () {
      yield* live;
      if (request.original !== original || request.command === null)
        return yield* Effect.fail(officeDenied());
      const command = request.command;
      yield* Effect.try({
        try: () => assertOfficeTaskCommand(task.proof, command),
        catch: officeDenied,
      });
      const claims = input.claims;
      if (claims.capability !== "draft-task") return yield* Effect.fail(officeDenied());
      if (input.phase === "request") {
        if (!officeSame(claims, actor)) return yield* Effect.fail(officeDenied());
        if (input.target !== null) yield* target(input.target);
      } else {
        if (input.phase === "recovery-dispatch") return yield* Effect.fail(officeDenied());
        if (!("operationId" in command.input) || command.input.operationId !== input.operationId)
          return yield* Effect.fail(officeDenied());
        const operation = yield* metadata.operation(actor.owner, input.operationId);
        if (
          operation === null ||
          !sameOfficeTaskInput(task.proof, operation) ||
          !officeSame(operation.actor, claims) ||
          operation.intentDigest !== input.intentDigest ||
          operation.documentId !== input.target.documentId ||
          operation.unitId !== input.target.unitId ||
          !officeSame(input.target.owner, actor.owner) ||
          operation.intent.kind === "approve" ||
          operation.intent.kind === "merge" ||
          (operation.intent.kind === "create" && operation.intent.input.destination !== "new-draft")
        )
          return yield* Effect.fail(officeDenied());
        if (input.phase === "recovery-observe") {
          yield* Effect.try({
            try: () => assertOfficeTaskObservedIntent(task.proof, operation),
            catch: officeDenied,
          });
          if (command.method !== "office.receipt" && !officeSame(claims, actor))
            return yield* Effect.fail(officeDenied());
          // Exact original receipt observation only; no current-generation content/turn/write grant.
          const bound = claims.target;
          if (
            bound !== null &&
            (input.target.scope.kind !== "draft" ||
              bound.documentId !== input.target.documentId ||
              bound.draftId !== input.target.scope.draftId ||
              bound.generation !== input.target.scope.generation)
          )
            return yield* Effect.fail(officeDenied());
          if (bound === null) {
            if (operation.intent.kind === "render" || operation.intent.kind === "export") {
              const historical = yield* metadata.historicalViewTarget(
                actor.owner,
                operation.intent.input.viewId,
              );
              if (historical === null || !officeSame(historical, input.target))
                return yield* Effect.fail(officeDenied());
            } else if (
              (operation.intent.kind !== "create" && operation.intent.kind !== "create-draft") ||
              input.target.scope.kind !== "draft" ||
              input.target.scope.generation !== 1 ||
              input.target.scope.draftId !== operation.receipt.draftId
            )
              return yield* Effect.fail(officeDenied());
          }
        } else {
          if (
            !officeSame(claims, actor) ||
            claims.expiresAt <= Date.now() ||
            command.method === "office.receipt"
          )
            return yield* Effect.fail(officeDenied());
          const intent = task.proof.association.intent.command;
          if (
            !("input" in intent) ||
            intent.command !== operation.intent.kind ||
            !officeSame(intent.input, operation.intent.input)
          )
            return yield* Effect.fail(officeDenied());
          const creation =
            operation.intent.kind === "create" || operation.intent.kind === "create-draft";
          yield* target(input.target, creation ? operation : null);
        }
      }
      yield* live;
      return undefined;
    });
}
