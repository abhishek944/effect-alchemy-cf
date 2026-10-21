import type { IncomingMessage, ServerResponse } from "node:http";
import { finished } from "node:stream/promises";
import { Effect } from "effect";
import {
  OfficeInvalid,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { HostOfficeRequest, hostEnvelope } from "@starter/office-server/native-remote";
import type { Actor, OfficeService } from "@starter/office-server/ports";
import { invokeOfficeCall } from "./native-office-call.ts";

/** PRIVATE metadata only. Input streams never contain native documents/code/blob JSON. */
export async function readOfficeNodeJson(
  request: IncomingMessage,
  signal: AbortSignal,
  deadline: number,
): Promise<unknown> {
  const completion = finished(request, { cleanup: true }).then(
    (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
    (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
  );
  const iterator: AsyncIterator<unknown> = request[Symbol.asyncIterator]();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      if (Date.now() >= deadline) throw new Error("Office request expired");
      const part = await iterator.next();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array)) throw new Error("Invalid Office metadata stream");
      bytes += part.value.byteLength;
      if (bytes > 16 * 1024 || chunks.length >= 1024) throw new Error("Office metadata limit");
      chunks.push(part.value);
    }
    const completed = await completion;
    if (completed.status === "rejected" || !request.complete)
      throw new Error("Incomplete Office metadata body");
  } catch (cause) {
    request.destroy();
    await completion;
    throw cause;
  }
  signal.throwIfAborted();
  if (Date.now() >= deadline) throw new Error("Office request expired");
  const result = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(result));
}
const reads = new Set([
  "office.list",
  "office.drafts",
  "office.document",
  "office.draft",
  "office.review",
  "office.receipt",
  "office.events",
]);
/** Actor must come from the genuine original T47 issuer, NEVER the untrusted JSON/body/headers. */
export async function handleOfficeControl(
  request: IncomingMessage,
  response: ServerResponse,
  service: OfficeService,
  binding: {
    readonly actor: Actor;
    readonly invocationId: string;
    readonly deadline: number;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  if (
    request.method !== "POST" ||
    request.url !== "/__office/core" ||
    request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() !== "application/json"
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const input = decodeWireSync(hostEnvelope(HostOfficeRequest))(
    await readOfficeNodeJson(request, binding.signal, binding.deadline),
  );
  if (input.invocationId !== binding.invocationId)
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const responseDone = finished(response, { cleanup: true }).then(
    (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
    (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
  );
  let payload: unknown;
  try {
    payload = await Effect.runPromise(invokeOfficeCall(service, binding.actor, input.payload));
    binding.signal.throwIfAborted();
    if (Date.now() >= binding.deadline) throw new Error("Office request expired");
  } catch {
    payload = {
      method: input.payload.method,
      error: safeFailure(reads.has(input.payload.method) ? "UNAVAILABLE" : "OUTCOME_UNKNOWN"),
    };
  }
  let output = JSON.stringify({
    version: 1,
    invocationId: input.invocationId,
    callId: input.callId,
    payload,
  });
  if (new TextEncoder().encode(output).byteLength > 16 * 1024) {
    output = JSON.stringify({
      version: 1,
      invocationId: input.invocationId,
      callId: input.callId,
      payload: {
        method: input.payload.method,
        error: safeFailure(reads.has(input.payload.method) ? "LIMIT_EXCEEDED" : "OUTCOME_UNKNOWN"),
      },
    });
  }
  if (binding.signal.aborted || response.destroyed || response.writableEnded)
    throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "private, no-store",
  });
  response.end(output);
  const completed = await responseDone;
  if (completed.status === "rejected") throw completed.reason;
}
