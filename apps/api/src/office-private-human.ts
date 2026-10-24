import { Effect } from "effect";
import type { ActorVerification, NativeTarget, OfficeMetadata } from "@starter/office-server/ports";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeCaught } from "./office-failure.ts";
import { officeDeniedReason as officeDenied, officeSame } from "./office-private-values.ts";

/** Actual original registration/session verification; reason tags confer no authority. */
export function officeHumanAuthority(metadata: OfficeMetadata, request: OfficePrivateRequest) {
  const actor = request.original.actor;
  const live = Effect.tryPromise({ try: request.live, catch: officeCaught });
  const target = (input: NativeTarget) =>
    Effect.gen(function* () {
      if (!officeSame(input.owner, actor.owner))
        return yield* Effect.fail(officeDenied("human-target-owner"));
      const document = yield* metadata.document(actor.owner, input.documentId);
      if (document === null)
        return yield* Effect.fail(officeDenied("human-target-document-missing"));
      if (document.unitId !== input.unitId)
        return yield* Effect.fail(officeDenied("human-target-unit"));
      if (input.scope.kind === "draft") {
        const draft = yield* metadata.draft(actor.owner, input.scope.draftId);
        if (draft === null) return yield* Effect.fail(officeDenied("human-target-draft-missing"));
        if (draft.documentId !== input.documentId)
          return yield* Effect.fail(officeDenied("human-target-draft-document"));
        if (draft.generation !== input.scope.generation)
          return yield* Effect.fail(officeDenied("human-target-generation"));
      }
      return undefined;
    });
  const verify = (input: ActorVerification) =>
    Effect.gen(function* () {
      yield* live;
      const claims = input.claims;
      if (claims.capability !== "human")
        return yield* Effect.fail(officeDenied("human-original-actor-kind"));
      if (claims.principalId !== actor.principalId)
        return yield* Effect.fail(officeDenied("human-original-principal"));
      if (input.phase !== "recovery-observe" && claims.sessionEpoch !== actor.sessionEpoch)
        return yield* Effect.fail(officeDenied("human-original-session-epoch"));
      if (!officeSame(claims.owner, actor.owner))
        return yield* Effect.fail(officeDenied("human-original-owner"));
      if (input.phase === "request") {
        if (!officeSame(claims, actor))
          return yield* Effect.fail(officeDenied("human-request-claims"));
        if (input.target !== null) yield* target(input.target);
      } else {
        if (input.phase !== "recovery-observe") {
          if (claims.expiresAt <= Date.now())
            return yield* Effect.fail(officeDenied("human-original-expired"));
          const command = request.command;
          if (command === null)
            return yield* Effect.fail(officeDenied("human-original-command-missing"));
          if (!("operationId" in command.input))
            return yield* Effect.fail(officeDenied("human-original-operation-missing"));
          if (command.input.operationId !== input.operationId)
            return yield* Effect.fail(officeDenied("human-original-operation-mismatch"));
          if (["office.receipt", "office.cancel"].includes(command.method))
            return yield* Effect.fail(officeDenied("human-original-control-dispatch"));
        }
        const operation = yield* metadata.operation(actor.owner, input.operationId);
        if (operation === null) return yield* Effect.fail(officeDenied("human-operation-missing"));
        if (!officeSame(operation.actor, claims))
          return yield* Effect.fail(officeDenied("human-operation-actor"));
        if (operation.intentDigest !== input.intentDigest)
          return yield* Effect.fail(officeDenied("human-operation-intent"));
        if (operation.unitId !== input.target.unitId)
          return yield* Effect.fail(officeDenied("human-operation-unit"));
        if (operation.documentId !== input.target.documentId)
          return yield* Effect.fail(officeDenied("human-operation-document"));
        // Observation retains old control identity without granting current-generation reads.
        if (input.phase !== "recovery-observe") yield* target(input.target);
      }
      yield* live;
      return undefined;
    });
  return { verify, target, live };
}
