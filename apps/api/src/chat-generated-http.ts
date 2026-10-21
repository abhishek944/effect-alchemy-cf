import { Schema } from "effect";
import { readBoundedBody } from "./body-limit.ts";
import { decodeOption, json } from "./chat-internal.ts";
import type { ChatGeneratedStorage } from "./chat-generated-storage.ts";
import {
  ImageCallKey,
  ImageOutputKey,
  ImageReceiptExpectation,
  ImageReservation,
  ImageStoreQuery,
  ImageStorageError,
} from "./chat-image-storage-schema.ts";

const Receipts = Schema.Struct({
  ...ImageCallKey.fields,
  after: Schema.optional(
    Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n >= -1)),
  ),
});
const status = (error: ImageStorageError): number => {
  if (error.code === "quota_exceeded") return 507;
  if (error.code === "invalid_input" || error.code === "invalid_output") return 400;
  return error.code === "unavailable" ? 503 : 409;
};
/** Private actor-only routes. Output bytes cross this boundary, never native state/JSON. */
export const handleChatGeneratedRequest = async (
  store: ChatGeneratedStorage,
  request: Request,
): Promise<Response | null> => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/files/generated/")) return null;
  try {
    if (request.method === "PUT" && url.pathname === "/files/generated/output") {
      const raw = Object.fromEntries(url.searchParams);
      const query = decodeOption(ImageStoreQuery, {
        ...raw,
        index: Number(raw.index),
        total: Number(raw.total),
      });
      if (query === null) throw new ImageStorageError("invalid_input");
      const file = await store.ingest(query, request);
      return json({ ok: true, value: file });
    }
    if (request.method === "GET") {
      const raw = Object.fromEntries(url.searchParams);
      if (url.pathname === "/files/generated/receipt") {
        const key = decodeOption(ImageOutputKey, { ...raw, index: Number(raw.index) });
        const expected = ["digest", "total", "byteSize", "mediaType"].some(
          (field) => raw[field] !== undefined,
        )
          ? decodeOption(ImageReceiptExpectation, {
              digest: raw.digest,
              total: Number(raw.total),
              byteSize: Number(raw.byteSize),
              mediaType: raw.mediaType,
            })
          : undefined;
        if (key === null || expected === null) throw new ImageStorageError("invalid_input");
        return json({ ok: true, value: await store.receipt(key, expected) });
      }
      if (url.pathname === "/files/generated/receipts") {
        const key = decodeOption(Receipts, {
          ...raw,
          ...(raw.after === undefined ? {} : { after: Number(raw.after) }),
        });
        if (key === null) throw new ImageStorageError("invalid_input");
        return json({ ok: true, value: await store.receipts(key, key.after) });
      }
    }
    if (request.method === "POST") {
      const bytes = await readBoundedBody(request, 65_536);
      if (bytes === null) throw new ImageStorageError("invalid_input");
      const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
      if (url.pathname === "/files/generated/reserve") {
        const input = decodeOption(ImageReservation, raw);
        if (input === null) throw new ImageStorageError("invalid_input");
        return json({ ok: true, value: store.reserve(input) });
      }
      const key = decodeOption(ImageCallKey, raw);
      if (key === null) throw new ImageStorageError("invalid_input");
      if (url.pathname === "/files/generated/consume")
        return json({ ok: true, value: store.consume(key) });
      if (url.pathname === "/files/generated/finish")
        return json({ ok: true, value: store.finish(key) });
    }
    return json({ ok: false, code: "invalid_input" }, 405);
  } catch (error) {
    if (error instanceof ImageStorageError)
      return json({ ok: false, code: error.code }, status(error));
    return json(
      { ok: false, code: error instanceof SyntaxError ? "invalid_input" : "unavailable" },
      error instanceof SyntaxError ? 400 : 503,
    );
  }
};
