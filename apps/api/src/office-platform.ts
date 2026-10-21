import type * as cf from "@cloudflare/workers-types";
import { Schema } from "effect";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";

const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
/** Native Web-IDL boundary only, like chat-bindings WorkerSignal/doStream. These constructors
 * NEVER authenticate a caller, process or grant. Actual private binding/session proof is separate.
 * Node-only infra and Worker compilations describe the SAME native runtime objects differently.
 */
const NativeSignal = Schema.declare<cf.AbortSignal>(
  (value): value is cf.AbortSignal => value instanceof AbortSignal,
);
const NativeRequest = Schema.declare<cf.Request>(
  (value): value is cf.Request => value instanceof Request,
);
export const officeNativeSignal = Schema.decodeUnknownSync(NativeSignal);
export const officeNativeRequest = Schema.decodeUnknownSync(NativeRequest);
export function officeWebResponse(value: unknown): Response {
  if (!(value instanceof Response)) throw unavailable();
  // Transfer the SAME body/socket; native Response init retains WebSocket101 and makes headers mutable.
  return new Response(value.body, value);
}
export function officeReadable(value: unknown): ReadableStream<unknown> {
  if (!(value instanceof ReadableStream)) throw unavailable();
  return value;
}
