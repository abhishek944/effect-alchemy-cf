import { OfficeLimited, decodeWireSync, safeFailure } from "@starter/office-contract";
import { hostEnvelope } from "@starter/office-server/native-remote";
import type { OfficeRemoteMethod } from "./native-channel.ts";
import type { OfficeBinaryResource } from "./native-transfer-resource.ts";

const limited = () => new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
export function officeBinaryPrefix(header: string): Uint8Array {
  const bytes = new TextEncoder().encode(header);
  if (bytes.length === 0 || bytes.length > 16 * 1024) throw limited();
  const prefix = new Uint8Array(bytes.length + 4);
  new DataView(prefix.buffer).setUint32(0, bytes.length);
  prefix.set(bytes, 4);
  return prefix;
}
/** Own the response reader BEFORE validation so invalid/late responses are still physically closed. */
export async function readOfficeBinaryReply<Q, A>(
  response: Response,
  definition: OfficeRemoteMethod<Q, A>,
  resource: OfficeBinaryResource,
  invocationId: string,
  callId: string,
  charge: (bytes: number) => void,
) {
  if (!(response instanceof Response) || response.body === null)
    throw new Error("Invalid private binary response");
  const cursor = officeBinaryCursor(response.body, resource.signal, resource.deadline, charge);
  resource.add(() => cursor.close());
  resource.check();
  if (
    response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !==
    "application/octet-stream"
  )
    throw new Error("Invalid private binary media type");
  const reply = decodeWireSync(hostEnvelope(definition.response))(await cursor.header());
  resource.check();
  if (
    reply.invocationId !== invocationId ||
    reply.callId !== callId ||
    reply.payload.method !== definition.method
  )
    throw new Error("Private binary association changed");
  return { reply, cursor };
}
/** Framing only. The channel validates this small metadata with the exact finite method schema. */
export function officeBinaryCursor(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  deadline: number,
  charge: (bytes: number) => void,
) {
  const reader = body.getReader();
  // A terminal reader needs lock release, not cancel() rethrowing its stored operation error.
  let terminal = false;
  const closed = reader.closed.then(
    () => {
      terminal = true;
      return undefined;
    },
    () => {
      terminal = true;
      return undefined;
    },
  );
  let chunk: Uint8Array = new Uint8Array(0);
  let offset = 0,
    closing: Promise<void> | undefined;
  const check = () => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Private binary deadline expired");
  };
  const next = async (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    check();
    if (offset < chunk.length) {
      const value = chunk.subarray(offset);
      offset = chunk.length;
      return { done: false, value };
    }
    const part = await reader.read();
    check();
    if (!part.done) {
      if (!(part.value instanceof Uint8Array)) throw new Error("Invalid private binary chunk");
      charge(part.value.byteLength);
    }
    return part;
  };
  const exact = async (size: number) => {
    const output = new Uint8Array(size);
    let used = 0;
    while (used < size) {
      const part = await next();
      if (part.done) throw new Error("Truncated private binary header");
      chunk = part.value;
      offset = Math.min(size - used, chunk.length);
      output.set(chunk.subarray(0, offset), used);
      used += offset;
    }
    return output;
  };
  return {
    next,
    async header(): Promise<unknown> {
      const length = new DataView((await exact(4)).buffer).getUint32(0);
      if (length === 0 || length > 16 * 1024) throw limited();
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await exact(length)));
    },
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      closing = Promise.resolve().then(async () => {
        const results = await Promise.allSettled([
          // Do not suppress a rejection from cancellation actually started on a live reader.
          Promise.resolve().then(() => (terminal ? undefined : reader.cancel())),
          closed,
        ]);
        reader.releaseLock();
        const cancelled = results[0];
        if (cancelled?.status === "rejected") throw cancelled.reason;
        return undefined;
      });
      return closing;
    },
  };
}
