import type * as cf from "@cloudflare/workers-types";
import * as Cloudflare from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { OfficeUnavailable, decodeWireSync, safeFailure } from "@starter/office-contract";

export type OfficeNamespace = Pick<cf.DurableObjectNamespace, "get" | "getByName">;
const Namespace = Schema.declare<OfficeNamespace>(
  (value): value is OfficeNamespace =>
    typeof value === "object" &&
    value !== null &&
    "get" in value &&
    typeof value.get === "function" &&
    "getByName" in value &&
    typeof value.getByName === "function",
);
/** Resolve the ACTUAL private same-script platform binding in a real event. Shape is not authority.
 * Raw native fetch is intentional: no Alchemy HandlerNotReady/HTTP retry transport for Office work.
 */
export const officePrivateNamespace = Effect.gen(function* () {
  const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
  return yield* Effect.try({
    try: () => decodeWireSync(Namespace)(env.OfficeHost),
    catch: () => new OfficeUnavailable(safeFailure("UNAVAILABLE")),
  });
});
