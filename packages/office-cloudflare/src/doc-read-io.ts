import type { Schema } from "effect";
import {
  OfficeForbidden,
  OfficeInvalid,
  OfficeLimited,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@highchat/office-contract";
import type { ErrorCode } from "@highchat/office-contract";
import type { DocReadLifetime } from "./doc-read-lifetime.ts";

export function docReadError(code: ErrorCode) {
  const failure = safeFailure(code);
  if (code === "FORBIDDEN" || code === "AUTHORITY_LOST") return new OfficeForbidden(failure);
  if (code === "INVALID_INPUT") return new OfficeInvalid(failure);
  if (code === "LIMIT_EXCEEDED") return new OfficeLimited(failure);
  return new OfficeUnavailable(failure);
}
export function readDocDto<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
  code: ErrorCode = "CONTENT_REQUIRED",
): S["Type"] {
  try {
    return decodeWireSync(schema)(input);
  } catch {
    throw docReadError(code);
  }
}
/** Cancels waiting only: callers separately observe/drain real provider work. */
export function waitDocIO<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(docReadError("FORBIDDEN"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    void work.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        if (signal.aborted) reject(docReadError("FORBIDDEN"));
        else resolve(value);
        return undefined;
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
        return undefined;
      },
    );
  });
}
export async function readDocBody(
  request: Request,
  life: DocReadLifetime,
  guard: () => Promise<void>,
): Promise<unknown> {
  if (
    !request.body ||
    request.headers.get("content-type")?.toLowerCase() !== "application/json" ||
    request.headers.has("content-encoding")
  )
    throw docReadError("INVALID_INPUT");
  const reader = request.body.getReader();
  let cancellation: Promise<void> | undefined;
  const cancel = () => {
    cancellation ??= reader.cancel();
    void cancellation.catch(() => undefined);
  };
  life.signal.addEventListener("abort", cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      await guard();
      const reading = life.track(
        Promise.resolve().then(() => {
          life.assertLive();
          return reader.read().then((chunk) => {
            if (!chunk.done) {
              if (!(chunk.value instanceof Uint8Array)) throw docReadError("INVALID_INPUT");
            }
            return chunk;
          });
        }),
      );
      const chunk = await waitDocIO(reading, life.signal);
      await guard();
      if (chunk.done) break;
      if (!(chunk.value instanceof Uint8Array)) throw docReadError("INVALID_INPUT");
      chunks.push(chunk.value);
      size += chunk.value.byteLength;
    }
    const declared = request.headers.get("content-length");
    if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) !== size))
      throw docReadError("INVALID_INPUT");
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      throw docReadError("INVALID_INPUT");
    }
  } finally {
    life.signal.removeEventListener("abort", cancel);
    try {
      await (cancellation ?? reader.cancel());
    } catch {
      life.cleanupFailed();
    } finally {
      reader.releaseLock();
    }
  }
}
export function streamDocReply(
  payload: Uint8Array,
  life: DocReadLifetime,
  guard: () => Promise<void>,
  cleanup: () => void,
) {
  let active: ReadableStreamDefaultController<Uint8Array> | undefined;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        active = controller;
        life.start(controller, cleanup);
      },
      pull(controller) {
        return life.track(
          (async () => {
            try {
              await waitDocIO(life.track(Promise.resolve().then(guard)), life.signal);
              life.assertLive();
              controller.enqueue(payload);
              controller.close();
            } catch {
              controller.error(docReadError("FORBIDDEN"));
            } finally {
              life.end(controller);
            }
          })(),
        );
      },
      cancel() {
        if (active) life.end(active);
        else cleanup();
      },
    },
    { highWaterMark: 0 },
  );
}
