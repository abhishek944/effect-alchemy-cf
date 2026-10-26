import { Effect } from "effect";
import * as HttpApiClient from "effect/http-api/HttpApiClient";
import { OfficeApi, UploadHeaders } from "./api.ts";
import { ArtifactRef } from "./models.ts";
import { decodeWireSync, Id } from "./primitives.ts";
import { OfficeInvalid, OfficeUnavailable } from "./errors.ts";
import { OFFICE_LIMITS } from "./limits.ts";

export type OfficeClient = HttpApiClient.ForApi<typeof OfficeApi>;
/** Supply an authenticated HttpClient at the host boundary; no auth/provider config is read here. */
export const makeOfficeClient = (baseUrl: string | URL) =>
  HttpApiClient.make(OfficeApi, { baseUrl });
export type BinaryUpload = {
  readonly operationId: string;
  readonly kind: "upload" | "code";
  readonly filename: string;
  readonly bytes: number;
  readonly digest?: string;
  readonly body: ReadableStream<Uint8Array>;
};
/** The generated upload method has no JSON body. This helper owns its streaming binary transport. */
export const uploadOfficeBytes = (
  baseUrl: string | URL,
  input: BinaryUpload,
  request: (url: URL, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init),
) =>
  Effect.tryPromise({
    try: async (signal) => {
      decodeWireSync(Id)(input.operationId);
      decodeWireSync(UploadHeaders)({
        "x-office-kind": input.kind,
        "x-office-filename": encodeURIComponent(input.filename),
        "x-office-bytes": input.bytes,
        ...(input.digest === undefined ? {} : { "x-office-digest": input.digest }),
      });
      const cap = input.kind === "code" ? OFFICE_LIMITS.codeBytes : OFFICE_LIMITS.uploadBytes;
      if (!Number.isSafeInteger(input.bytes) || input.bytes < 0 || input.bytes > cap)
        throw new OfficeInvalid({
          code: "LIMIT_EXCEEDED",
          message: "Upload exceeds its byte limit.",
          operationId: input.operationId,
        });
      let seen = 0;
      const reader = input.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          try {
            const part = await reader.read();
            if (part.done) {
              if (seen !== input.bytes) throw new Error("Upload length mismatch");
              controller.close();
              return;
            }
            seen += part.value.byteLength;
            if (seen > input.bytes) throw new Error("Upload length mismatch");
            controller.enqueue(part.value);
          } catch {
            await reader.cancel().catch(() => undefined);
            controller.error(new Error("Upload stream failed"));
          }
        },
        cancel: (reason) => reader.cancel(reason),
      });
      const headers = new Headers({
        "content-type": "application/octet-stream",
        "x-office-kind": input.kind,
        "x-office-filename": encodeURIComponent(input.filename),
        "x-office-bytes": String(input.bytes),
      });
      if (input.digest !== undefined) headers.set("x-office-digest", input.digest);
      // Node fetch requires duplex; browsers ignore the extra standard-dictionary member.
      const init: RequestInit & { duplex: "half"; credentials: "same-origin" } = {
        method: "PUT",
        headers,
        body,
        signal,
        credentials: "same-origin",
        duplex: "half",
      };
      const url = new URL(`/api/office/uploads/${input.operationId}`, baseUrl);
      const response = await request(url, init);
      if (!response.ok) throw new Error("Office upload rejected");
      if (Number(response.headers.get("content-length") ?? 0) > OFFICE_LIMITS.metadataBytes)
        throw new Error("Office upload response exceeded limit");
      if (response.body === null) throw new Error("Office upload response is empty");
      const output = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await output.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > OFFICE_LIMITS.metadataBytes)
            throw new Error("Office upload response exceeded limit");
          chunks.push(part.value);
        }
      } finally {
        await output.cancel().catch(() => undefined);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      const ref = decodeWireSync(ArtifactRef)(JSON.parse(new TextDecoder().decode(bytes)));
      if (
        ref.kind !== input.kind ||
        ref.bytes !== input.bytes ||
        (input.digest !== undefined && ref.digest !== input.digest)
      )
        throw new Error("Office upload acknowledgement does not match the source");
      return ref;
    },
    catch: (cause) =>
      cause instanceof OfficeInvalid
        ? cause
        : new OfficeUnavailable({
            code: "UNAVAILABLE",
            message: "The Office upload could not be confirmed.",
            operationId: input.operationId,
          }),
  });
