import { OfficeLimited, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officeReadable } from "./office-platform.ts";

const unavailable = () => new OfficeUnavailable(safeFailure("UNAVAILABLE"));
const limited = () => new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
/** Worker-only v1 transport framing. No import of Node channel/SDK implementations into Worker graph. */
export function officeBinaryPrefix(header: string): Uint8Array {
  const bytes = new TextEncoder().encode(header);
  if (bytes.byteLength === 0 || bytes.byteLength > 16 * 1024) throw limited();
  const prefix = new Uint8Array(bytes.byteLength + 4);
  new DataView(prefix.buffer).setUint32(0, bytes.byteLength);
  prefix.set(bytes, 4);
  return prefix;
}
export function officeBinaryCursor(
  body: unknown,
  signal: AbortSignal,
  deadline: number,
  charge: (bytes: number) => void,
) {
  const reader = officeReadable(body).getReader();
  const closed = reader.closed.then(
    () => true,
    () => false,
  );
  let chunk: Uint8Array = new Uint8Array(0),
    offset = 0,
    empty = 0;
  let pending: Promise<void> | undefined, closing: Promise<void> | undefined;
  const check = () => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw unavailable();
  };
  const next = async (): Promise<
    { readonly done: true } | { readonly done: false; readonly value: Uint8Array }
  > => {
    check();
    if (offset < chunk.byteLength) {
      const value = chunk.subarray(offset);
      offset = chunk.byteLength;
      return { done: false, value };
    }
    const actual = reader.read();
    pending = actual.then(
      () => undefined,
      () => undefined,
    );
    const part = await actual;
    check();
    if (!part.done) {
      if (!(part.value instanceof Uint8Array)) throw unavailable();
      if (part.value.byteLength === 0 && ++empty > 1024) throw limited();
      charge(part.value.byteLength);
      return { done: false, value: part.value };
    }
    return { done: true };
  };
  const exact = async (size: number) => {
    const output = new Uint8Array(size);
    let used = 0;
    while (used < size) {
      const part = await next();
      if (part.done) throw unavailable();
      chunk = part.value;
      offset = Math.min(size - used, chunk.byteLength);
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
      return JSON.parse(
        new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(await exact(length)),
      );
    },
    close(): Promise<void> {
      if (closing !== undefined) return closing;
      closing = Promise.resolve().then(async () => {
        const cancellation = Promise.resolve().then(() => reader.cancel());
        const results = await Promise.allSettled([pending, cancellation, closed]);
        let failed = results.some((item) => item.status === "rejected" || item.value === false);
        try {
          reader.releaseLock();
        } catch {
          failed = true;
        }
        if (failed) throw unavailable();
        return undefined;
      });
      return closing;
    },
  };
}
