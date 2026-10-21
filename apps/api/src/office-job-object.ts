import { Effect } from "effect";
import type * as cf from "@cloudflare/workers-types";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { createOfficeMetadata } from "@starter/office-cloudflare/metadata";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import { officeJobProcess } from "./office-job-process.ts";

const unknown = () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
/** Separate fresh role/instance in the SAME namespace/application image, never the warm host. */
export function officeJobRole(
  state: cf.DurableObjectState,
  image: string,
  resources: OfficeProviderOptions,
  owner: OwnerScope,
  jobId: string,
  nodeId: string,
) {
  const process = officeJobProcess(state, image);
  const metadata = createOfficeMetadata(resources);
  let issued = false;
  return {
    runJob: (body: ReadableStream<unknown>) =>
      Effect.gen(function* () {
        if (issued) return yield* Effect.fail(unknown());
        issued = true;
        const claim = yield* metadata.job(owner, jobId);
        if (claim === null || claim.version !== 1 || claim.state.state !== "running")
          return yield* Effect.fail(unknown());
        const dispatch = claim.dispatch;
        if (
          dispatch === null ||
          dispatch.workerId !== nodeId ||
          dispatch.deadlineAt <= Date.now() ||
          claim.job.binding.imageDigest !== image.slice(image.lastIndexOf("@") + 1)
        )
          return yield* Effect.fail(unknown());
        // Physical joins belong to status()/close(); a blocking request-scope finalizer would withhold
        // the response body and self-deadlock the Worker that must consume it.
        const actual = yield* Effect.tryPromise({
          try: (signal) => process.run(body, signal, dispatch.deadlineAt),
          catch: unknown,
        });
        return actual.body;
      }),
    jobStatus: (cancel: boolean) =>
      Effect.tryPromise({
        try: async () => {
          if (cancel) {
            issued = true;
            await process.close();
          }
          return process.status();
        },
        catch: unknown,
      }),
    close: () => process.close(),
  };
}
export type OfficeJobRole = ReturnType<typeof officeJobRole>;
