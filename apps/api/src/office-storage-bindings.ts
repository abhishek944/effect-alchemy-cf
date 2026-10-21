import type { D1Database, R2Bucket } from "@cloudflare/workers-types";
import { OfficeUnavailable, decodeWireSync, safeFailure } from "@starter/office-contract";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";

const Database = Schema.declare<D1Database>(
  (value): value is D1Database =>
    typeof value === "object" &&
    value !== null &&
    "prepare" in value &&
    typeof value.prepare === "function" &&
    "batch" in value &&
    typeof value.batch === "function" &&
    "withSession" in value &&
    typeof value.withSession === "function",
);
const Bucket = Schema.declare<R2Bucket>(
  (value): value is R2Bucket =>
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    typeof value.get === "function" &&
    "head" in value &&
    typeof value.head === "function" &&
    "put" in value &&
    typeof value.put === "function" &&
    "delete" in value &&
    typeof value.delete === "function" &&
    "list" in value &&
    typeof value.list === "function",
);
const Resources = Schema.Struct({ database: Database, bucket: Bucket });

/** Resolve ONLY existing stack bindings inside a real Worker event; not caller/Node credentials. */
export const officeStorageBindings = Effect.gen(function* () {
  const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
  return yield* Effect.try({
    try: (): Pick<OfficeProviderOptions, "database" | "bucket"> =>
      decodeWireSync(Resources)({ database: env.OFFICE_D1, bucket: env.OFFICE_R2 }),
    catch: () => new OfficeUnavailable(safeFailure("UNAVAILABLE")),
  });
});
