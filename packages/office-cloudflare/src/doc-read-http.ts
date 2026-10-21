import {
  safeFailure,
  OfficeForbidden,
  OfficeInvalid,
  OfficeLimited,
  OfficeUnavailable,
} from "@starter/office-contract";
import type { ErrorCode } from "@starter/office-contract";
import {
  DOC_READ_LIMITS,
  DocReadRequest,
  NativePartRequest,
} from "@starter/office-server/native-remote";
import { NativeStorageError } from "./native/index.ts";
import { openDocReadData } from "./doc-read-data.ts";
import { docReadError, readDocDto, readDocBody, streamDocReply } from "./doc-read-io.ts";
import { createDocReadLifetime } from "./doc-read-lifetime.ts";
export type DocReadSessionOptions = Parameters<typeof createDocReadLifetime>[0];

function safeError(error: unknown) {
  let code: ErrorCode = "UNAVAILABLE";
  if (
    error instanceof OfficeForbidden ||
    error instanceof OfficeInvalid ||
    error instanceof OfficeLimited ||
    error instanceof OfficeUnavailable
  )
    code = error.code;
  else if (error instanceof NativeStorageError)
    code =
      error.code === "FENCE"
        ? "AUTHORITY_LOST"
        : error.code === "LIMIT"
          ? "LIMIT_EXCEEDED"
          : error.code === "SCOPE" || error.code === "DISPOSED" || error.code === "READ_ONLY"
            ? "FORBIDDEN"
            : "CONTENT_REQUIRED";
  return docReadError(code);
}
/** Private component; the host supplies real live authority and MUST await disposal. */
export async function createDocReadSession(options: DocReadSessionOptions) {
  let life;
  try {
    life = createDocReadLifetime(options);
  } catch (error) {
    throw safeError(error);
  }
  const { config } = life;
  try {
    const readers = Object.freeze({
      readInvocation: options.native.readInvocation.bind(options.native),
      readReferences: options.native.readReferences.bind(options.native),
    });
    const data = await life.track(
      openDocReadData(readers, config.scope, config.access, config.ceiling, config.budget, () =>
        life.check(),
      ),
    );
    await life.attach(() => data.dispose());
    await life.check();
    const response = (
      payload: Uint8Array,
      status: number,
      type: string,
      guard: () => Promise<void>,
      cleanup: () => void,
    ) =>
      new Response(streamDocReply(payload, life, guard, cleanup), {
        status,
        headers: {
          "content-type": type,
          "content-length": String(payload.byteLength),
          "cache-control": "private, no-store",
        },
      });
    const handle = async (request: Request, cleanup: () => void): Promise<Response> => {
      const guard = () => life.check(request.signal);
      let transferred = false;
      try {
        life.assertLive(request.signal);
        const url = new URL(request.url);
        // Exact canonical URL also rejects userinfo and even empty query/fragment delimiters.
        if (
          request.method !== "POST" ||
          url.href !== config.origin + url.pathname ||
          request.headers.get("x-office-read-id") !== config.requestId ||
          !["/native-doc/control", "/native-doc/part"].includes(url.pathname)
        )
          throw docReadError("FORBIDDEN");
        const raw = await readDocBody(request, life, guard);
        let payload: Uint8Array,
          needsUnit = true,
          type = "application/json";
        if (url.pathname === "/native-doc/control") {
          const result = await data.control(
            readDocDto(DocReadRequest, raw, "INVALID_INPUT"),
            guard,
          );
          payload = new TextEncoder().encode(JSON.stringify(result));
          if (payload.byteLength > DOC_READ_LIMITS.metadataBytes)
            throw docReadError("LIMIT_EXCEEDED");
          life.charge(payload.byteLength);
          needsUnit =
            result.method === "snapshot" ? result.manifest !== null : result.unit !== null;
        } else {
          payload = await data.part(
            readDocDto(NativePartRequest, raw, "INVALID_INPUT"),
            guard,
            (size) => life.charge(size),
          );
          type = "application/octet-stream";
        }
        const emit = async () => {
          const current = await data.unit(guard);
          if (needsUnit && current === null) throw docReadError("AUTHORITY_LOST");
          life.assertLive(request.signal);
        };
        await emit();
        const reply = response(payload, 200, type, emit, cleanup);
        transferred = true;
        return reply;
      } catch (error) {
        life.assertLive(request.signal);
        const { code } = safeError(error);
        const payload = new TextEncoder().encode(JSON.stringify(safeFailure(code)));
        life.charge(payload.byteLength);
        const status =
          code === "INVALID_INPUT"
            ? 400
            : code === "LIMIT_EXCEEDED"
              ? 413
              : code === "FORBIDDEN" || code === "AUTHORITY_LOST"
                ? 403
                : 503;
        const reply = response(payload, status, "application/json", guard, cleanup);
        transferred = true;
        return reply;
      } finally {
        if (!transferred) cleanup();
      }
    };
    return Object.freeze({
      fetch: (request: Request) => life.enqueue(request, (cleanup) => handle(request, cleanup)),
      dispose: () => life.dispose(),
    });
  } catch (error) {
    await life.dispose();
    throw safeError(error);
  }
}
