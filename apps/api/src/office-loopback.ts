import type * as cf from "@cloudflare/workers-types";
import { Schema } from "effect";
import { OfficeUnavailable, decodeWireSync, safeFailure } from "@starter/office-contract";
import type { OfficeNamespace } from "./office-private-bindings.ts";

type Loopback = (init: { readonly props: { readonly target: cf.Fetcher } }) => cf.Fetcher;
const Exports = Schema.declare<Readonly<Record<string, unknown>>>(
  (value): value is Readonly<Record<string, unknown>> =>
    typeof value === "object" && value !== null && !Array.isArray(value),
);
const LoopbackSchema = Schema.declare<Loopback>(
  (value): value is Loopback => typeof value === "function",
);
const Fetcher = Schema.declare<cf.Fetcher>(
  (value): value is cf.Fetcher =>
    typeof value === "object" &&
    value !== null &&
    "fetch" in value &&
    typeof value.fetch === "function",
);
const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));

/** REAL ctx.exports loopback Fetcher, never a user-defined { fetch } pretending to be a binding.
 * `state.exports` is a platform-provided export map; validate the actual entry and its result.
 * Props carry the original DO capability into the native storage entry, never a serialized ID.
 */
export function officeStorageLoopback(
  state: cf.DurableObjectState,
  namespace: OfficeNamespace,
): cf.Fetcher {
  try {
    const entry = decodeWireSync(Exports)(state.exports).OfficeStorage;
    const loopback = decodeWireSync(LoopbackSchema)(entry);
    return decodeWireSync(Fetcher)(loopback({ props: { target: namespace.get(state.id) } }));
  } catch {
    throw unavailable();
  }
}
