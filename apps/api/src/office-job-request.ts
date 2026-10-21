import { decodeWireSync } from "@starter/office-contract";
import { HostJobRecord } from "@starter/office-server/native-remote";
import type { JobRecord } from "@starter/office-server/ports";
import { officeBinaryCursor } from "./office-private-frame.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

/** Finite OJOB METADATA header only; native input/model code stay opaque streamed bytes.
 * The actual fixed pinned job worker ALSO hashes/counts both payloads BEFORE executing any code.
 */
export async function officeJobRequest(
  source: ReadableStream<Uint8Array>,
  original: JobRecord,
  signal: AbortSignal,
  deadline: number,
  revoke: () => void,
) {
  let total = 0,
    empty = 0;
  const cursor = officeBinaryCursor(source, signal, deadline, (bytes) => {
    total += bytes;
    if (total > 34 * 1024 * 1024) throw officeDenied();
  });
  let chunk: Uint8Array = new Uint8Array(0);
  let offset = 0;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= Promise.resolve().then(async () => {
      signal.removeEventListener("abort", abort);
      await cursor.close();
      return undefined;
    });
    return closing;
  };
  const abort = () => {
    revoke();
    void close().catch(() => undefined);
  };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const next = async () => {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw officeDenied();
    if (offset < chunk.byteLength) {
      const value = chunk.subarray(offset);
      offset = chunk.byteLength;
      return { done: false as const, value };
    }
    const part = await cursor.next();
    if (!part.done && part.value.byteLength === 0 && ++empty > 1024) throw officeDenied();
    return part;
  };
  const exact = async (length: number) => {
    const bytes = new Uint8Array(length);
    let count = 0;
    while (count < length) {
      const part = await next();
      if (part.done) throw officeDenied();
      chunk = part.value;
      offset = Math.min(length - count, chunk.byteLength);
      bytes.set(chunk.subarray(0, offset), count);
      count += offset;
    }
    return bytes;
  };
  try {
    const fixed = await exact(16);
    if (fixed[0] !== 79 || fixed[1] !== 74 || fixed[2] !== 79 || fixed[3] !== 66)
      throw officeDenied();
    const header = new DataView(fixed.buffer);
    const metadataBytes = header.getUint32(4),
      inputBytes = header.getUint32(8),
      codeBytes = header.getUint32(12);
    if (
      metadataBytes === 0 ||
      metadataBytes > 16 * 1024 ||
      inputBytes > 32 * 1024 * 1024 ||
      codeBytes > 32 * 1024
    )
      throw officeDenied();
    const metadata = await exact(metadataBytes);
    const job = decodeWireSync(HostJobRecord.fields.job)(
      JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(metadata)),
    );
    if (
      !officeSame(job, original.job) ||
      inputBytes !== job.input.bytes ||
      (job.kind === "import" && job.input.digest !== job.binding.inputDigest) ||
      (job.kind === "execute"
        ? codeBytes !== job.code.bytes || job.code.digest !== job.binding.codeDigest
        : codeBytes !== 0)
    )
      throw officeDenied();
    const prefix = new Uint8Array(16 + metadataBytes);
    prefix.set(fixed);
    prefix.set(metadata, 16);
    let remaining = inputBytes + codeBytes;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(prefix);
      },
      async pull(controller) {
        try {
          signal.throwIfAborted();
          if (Date.now() >= deadline) throw officeDenied();
          const part = await next();
          if (part.done) {
            if (remaining !== 0) throw officeDenied();
            await close();
            controller.close();
            return;
          }
          if (part.value.byteLength > remaining) throw officeDenied();
          remaining -= part.value.byteLength;
          controller.enqueue(part.value);
        } catch {
          revoke();
          try {
            await close();
          } catch {
            controller.error(officeDenied());
            return;
          }
          controller.error(officeDenied());
        }
      },
      async cancel() {
        revoke();
        await close();
      },
    });
    return { body, close };
  } catch (error) {
    revoke();
    await close();
    throw error;
  }
}
