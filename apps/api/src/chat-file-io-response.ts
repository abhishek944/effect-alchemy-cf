import type * as cf from "@cloudflare/workers-types";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { publicFail } from "./chat-files-public.ts";
import { holdFileBody } from "./chat-file-io-body.ts";
import { ChatFileIOUnavailable, withFileMemory } from "./chat-file-io-memory.ts";
import { openFileObject, statFileObject } from "./chat-file-io-objects.ts";

const asciiName = (name: string): string =>
  name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 64) || "file";
const encodedName = (name: string): string =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );

/** Same security/download headers. HEAD uses metadata; counted GET streams use runtime framing. */
export const originalResponse = (
  request: Request,
  descriptor: FileDescriptor,
  body: Uint8Array | ReadableStream<Uint8Array> | null,
): Response => {
  const image = descriptor.kind === "image";
  const office = descriptor.kind === "office";
  const headers = new Headers({
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "default-src 'none'; sandbox",
    "cross-origin-resource-policy": "same-origin",
    "content-disposition":
      `${image ? "inline" : "attachment"}; ` +
      `filename="${asciiName(descriptor.name)}"; filename*=UTF-8''${encodedName(descriptor.name)}`,
    "content-type": image || office ? descriptor.mediaType : "text/plain; charset=utf-8",
  });
  if (request.method === "HEAD" || body instanceof Uint8Array)
    headers.set(
      "content-length",
      String(body instanceof Uint8Array ? body.byteLength : descriptor.byteSize),
    );
  return new Response(request.method === "HEAD" ? null : body, { headers });
};

/** Keys are server-derived stage, then retained. Only absence permits fallback. */
export const serveFileOriginal = async (
  request: Request,
  descriptor: FileDescriptor,
  bucket: cf.R2Bucket,
  keys: readonly string[],
): Promise<Response> => {
  try {
    for (const key of keys) {
      const head = await statFileObject(bucket, key, descriptor);
      if (head === null) continue;
      if (request.method === "HEAD") return originalResponse(request, descriptor, null);
      const response = await withFileMemory(descriptor.kind, descriptor.byteSize, async (lease) => {
        if (request.signal.aborted) throw new ChatFileIOUnavailable();
        const object = await openFileObject(bucket, key, head, descriptor);
        if (object === null) return null;
        const held = await holdFileBody(object.body, descriptor.byteSize, lease, request.signal);
        try {
          return originalResponse(request, descriptor, held.body);
        } catch {
          await held.cancel();
          throw new ChatFileIOUnavailable();
        }
      });
      // Headers resolved, but the actual counted response body remains tracked through EOF/cancel/error.
      if (response !== null) return response;
    }
    return publicFail("attachment_not_ready", 410);
  } catch {
    return publicFail("unavailable", 503);
  }
};
