import { Effect, Exit } from "effect";
import type { ArtifactRef, OfficeError } from "@starter/office-contract";
import type { OfficeBytes, OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeMetadataCall, OfficeMetadataResponse } from "./office-metadata-dispatch.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeCaught, officeDenied, officeSame } from "./office-private-authority.ts";
import { sameOfficeTaskInput } from "./office-task-lineage.ts";
import { authorizeOfficeTaskMetadata } from "./office-task-metadata.ts";
import { officeTaskOriginalRef } from "./office-task-metadata-record.ts";
import { officeTaskStagedRef } from "./office-task-proof.ts";
import {
  officeTaskReviewGraph,
  officeTaskReviewArtifact,
  assertOfficeTaskReviewResult,
} from "./office-task-review.ts";
import {
  officeTaskDescriptorRequest,
  assertOfficeTaskDescriptorResult,
} from "./office-task-descriptor.ts";

function remember(map: Map<string, ArtifactRef>, ref: ArtifactRef): void {
  if (map.size >= 1024 && !map.has(ref.id)) throw officeDenied();
  const old = map.get(ref.id);
  if (old !== undefined && !officeSame(old, ref)) throw officeDenied();
  map.set(ref.id, Object.freeze(structuredClone(ref)));
}

/** Same-frame ACTUAL provider results only. This bounded acknowledgement set is not a DB mirror. */
export function officeTaskStorage(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  raw: OfficeBytes,
) {
  const produced = new Map<string, ArtifactRef>();
  const observed = new Map<string, ArtifactRef>();
  let putting = 0;
  const acknowledged = (ref: ArtifactRef) => officeSame(produced.get(ref.id), ref);
  const awaitGraph = () =>
    Effect.tryPromise({ try: () => officeTaskReviewGraph(metadata, request), catch: officeCaught });
  const allowed = (ref: ArtifactRef) =>
    Effect.gen(function* () {
      const original = request.original;
      if (!("task" in original)) return true;
      if (acknowledged(ref) || officeSame(observed.get(ref.id), ref)) return true;
      const command = request.command;
      if (command === null || request.file !== null) return false;
      if (officeTaskOriginalRef(original, ref) || officeTaskStagedRef(original.task.proof, ref))
        return true;
      const graph = awaitGraph();
      const review = yield* graph;
      if (review !== null && officeTaskReviewArtifact(review, ref)) return true;
      const selected = original.task.binding.readView;
      if (selected?.source.kind === "artifact" && officeSame(selected.source.artifact, ref))
        return true;
      if ("operationId" in command.input) {
        const operation = yield* metadata.operation(
          original.actor.owner,
          command.input.operationId,
        );
        if (operation === null || !sameOfficeTaskInput(original.task.proof, operation))
          return false;
        if (
          Object.values(operation.artifacts).some((value) => officeSame(value, ref)) ||
          officeSame(operation.receipt.artifact, ref)
        )
          return true;
        if (operation.jobId !== null) {
          const job = yield* metadata.job(original.actor.owner, operation.jobId);
          if (
            job !== null &&
            job.job.binding.operationId === operation.receipt.operationId &&
            (officeSame(job.job.input, ref) ||
              (job.state.state === "succeeded" && officeSame(job.state.output, ref)))
          )
            return true;
        }
      }
      // A codeId alone is not provenance: only a verified native staging receipt permits prior code.
      return false;
    });
  const bytes: OfficeBytes = !("task" in request.original)
    ? raw
    : {
        put: (owner, input) =>
          Effect.uninterruptible(
            Effect.suspend(() => {
              if (
                officeTaskDescriptorRequest(request) ||
                !officeSame(owner, request.original.actor.owner) ||
                produced.size + putting >= 1024
              )
                return Effect.fail(officeDenied());
              putting++;
              return raw.put(owner, input).pipe(
                Effect.flatMap((ref) =>
                  Effect.try({
                    try: () => {
                      remember(produced, ref);
                      return ref;
                    },
                    catch: officeCaught,
                  }),
                ),
                Effect.ensuring(
                  Effect.sync(() => {
                    putting--;
                  }),
                ),
              );
            }),
          ),
        get: (owner, id) =>
          Effect.gen(function* () {
            if (!officeSame(owner, request.original.actor.owner))
              return yield* Effect.fail(officeDenied());
            yield* awaitGraph();
            const value = yield* raw.get(owner, id);
            if (value === null) return null;
            const checked = yield* Effect.exit(allowed(value.ref));
            const cleanup = Effect.tryPromise({
              try: () => value.body.cancel(),
              catch: officeCaught,
            }).pipe(Effect.uninterruptible);
            if (Exit.isFailure(checked))
              return yield* Effect.failCause(checked.cause).pipe(Effect.onExit(() => cleanup));
            if (!checked.value) {
              yield* cleanup;
              return yield* Effect.fail(officeDenied());
            }
            return value;
          }),
        removeUnreachable: () => Effect.fail(officeDenied()),
      };
  return {
    bytes,
    authorize: (call: OfficeMetadataCall): Effect.Effect<void, OfficeError> =>
      Effect.tryPromise({
        try: () => authorizeOfficeTaskMetadata(metadata, request, call, acknowledged),
        catch: officeCaught,
      }),
    async after(response: OfficeMetadataResponse) {
      if (!("task" in request.original) || !("value" in response)) return;
      await assertOfficeTaskReviewResult(metadata, request, response);
      await assertOfficeTaskDescriptorResult(metadata, request, response);
      if (
        response.method === "metadata.job" ||
        response.method === "metadata.reserveJob" ||
        response.method === "metadata.advanceJob"
      ) {
        const value = response.value;
        if (value === null) return;
        remember(observed, value.job.input);
        if (value.state.state === "succeeded") remember(observed, value.state.output);
      }
    },
  };
}
