import { Schema } from "effect";
import { safeGatewayOutputUrl } from "./chat-sdk-images-work.ts";

// Preserve the installed 0.6.0 engine's 20 MiB image and catalog-envelope boundaries.
const imageBytes = 20 * 1024 * 1024;
const envelopeBytes = Math.ceil(imageBytes / 3) * 4 + 1024 * 1024;
const Envelope = Schema.Struct({
  data: Schema.Array(
    Schema.Struct({
      b64_json: Schema.optionalKey(Schema.String),
      url: Schema.optionalKey(Schema.String),
      revised_prompt: Schema.optionalKey(Schema.String),
      media_type: Schema.optionalKey(Schema.String),
    }),
  ),
  usage: Schema.optionalKey(Schema.Json),
  cost: Schema.optionalKey(Schema.Json),
  currency: Schema.optionalKey(Schema.Json),
});

const readBytes = async (response: Response, maximum: number, signal?: AbortSignal) => {
  const reader = response.body?.getReader();
  if (reader === undefined) throw new Error("Empty image response");
  const chunks: Uint8Array[] = [];
  let total = 0;
  const abort = () => {
    void reader.cancel().catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      signal?.throwIfAborted();
      const part = await reader.read();
      signal?.throwIfAborted();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximum) throw new Error("Image response exceeds the SDK boundary");
      chunks.push(part.value);
    }
    return Buffer.concat(chunks);
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};

/** No provider credentials on output downloads; every redirect is refused. */
export const loadGatewayImageOutput = async (value: string, signal?: AbortSignal) => {
  const url = safeGatewayOutputUrl(value);
  if (url === null) throw new Error("Image output URL is not enabled");
  const response = await fetch(url, { signal: signal ?? null, redirect: "error" });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("Image output download failed");
  }
  return {
    bytes: await readBytes(response, imageBytes, signal),
    mimeType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
  };
};

/** Public SDK transport hook, not a serializer: SDK owns JSON generation and multipart edits. */
export const gatewayImageFetch =
  (baseUrl: string, key: string, customer: string, onDispatch: () => void): typeof fetch =>
  async (input, init) => {
    const request = new Request(input, init);
    if (
      request.method !== "POST" ||
      !["/v1/images/generations", "/v1/images/edits"].some(
        (path) => request.url === new URL(path, baseUrl).href,
      )
    )
      throw new Error("Image endpoint refused");
    const headers = new Headers(request.headers);
    headers.set("authorization", `Bearer ${key}`);
    headers.delete("x-litellm-end-user-id");
    headers.set("x-litellm-customer-id", customer);
    request.signal.throwIfAborted();
    onDispatch();
    const response = await fetch(new Request(request, { headers, redirect: "error" }));
    if (!response.ok) return response;
    try {
      if (!response.headers.get("content-type")?.includes("json"))
        throw new Error("Image response is not JSON");
      const value: unknown = JSON.parse(
        (await readBytes(response, envelopeBytes, request.signal)).toString("utf8"),
      );
      const body = Schema.decodeUnknownSync(Envelope)(value);
      const data = [];
      for (const entry of body.data) {
        if (entry.b64_json || entry.url === undefined || /^data:image\//i.test(entry.url))
          data.push(entry);
        else {
          // Materialize through the app policy before root SDK output loading can run.
          const output = await loadGatewayImageOutput(entry.url, request.signal);
          data.push({
            b64_json: Buffer.from(output.bytes).toString("base64"),
            media_type: output.mimeType,
            ...(entry.revised_prompt === undefined ? {} : { revised_prompt: entry.revised_prompt }),
          });
        }
      }
      const resultHeaders = new Headers(response.headers);
      resultHeaders.delete("content-length");
      resultHeaders.delete("content-encoding");
      resultHeaders.set("content-type", "application/json");
      return new Response(JSON.stringify({ ...body, data }), { headers: resultHeaders });
    } catch {
      throw new Error("Image response could not be verified");
    }
  };
