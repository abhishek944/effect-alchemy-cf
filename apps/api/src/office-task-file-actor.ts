import { Effect } from "effect";
import type { OfficeMetadata, VerifyActor } from "@starter/office-server/ports";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeCaught, officeDenied, officeSame } from "./office-private-authority.ts";
import { officeTaskActorPolicy } from "./office-task-actor-policy.ts";
import { assertOfficeTaskUpload } from "./office-task-command.ts";

/** Only actual Root registrations. File stages have no HostOfficeRequest or native target. */
export function officeTaskVerifier(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  human: VerifyActor,
): VerifyActor {
  const original = request.original;
  if (!("task" in original)) return human;
  if (request.file === null) return officeTaskActorPolicy(metadata, request, original);
  return (input) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise({ try: request.live, catch: officeCaught });
      const file = request.file;
      if (
        request.original !== original ||
        request.command !== null ||
        file?.kind !== "upload" ||
        input.phase !== "request" ||
        !officeSame(input.claims, original.actor) ||
        input.target !== null ||
        input.intentDigest !== null ||
        input.operationId !== file.input.operationId
      )
        return yield* Effect.fail(officeDenied());
      yield* Effect.try({
        try: () => assertOfficeTaskUpload(original.task.proof, file.input),
        catch: officeCaught,
      });
      yield* Effect.tryPromise({ try: request.live, catch: officeCaught });
      return undefined;
    });
}
