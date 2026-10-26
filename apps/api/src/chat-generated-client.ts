import type * as cf from "@cloudflare/workers-types";
import type { ImageHost } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import { decodeOption } from "./chat-internal.ts";
import { SavedFile } from "./chat-library-schema.ts";
import { MAX_IMAGE_BYTES } from "./chat-attachment-schema.ts";
import {
  type ImageCallKey,
  type ImageReservation,
  ImageStorageError,
  ImageStorageFailureCode,
  type ImageOutputKey,
  ImageReceiptExpectation,
} from "./chat-image-storage-schema.ts";

const Receipt = Schema.Struct({
  index: Schema.Number,
  state: Schema.Literals(["accepted", "unresolved"]),
  file: Schema.NullOr(SavedFile),
});
const Receipts = Schema.Struct({
  state: Schema.Literals(["reserved", "running", "finished"]),
  outputs: Schema.Array(Receipt).check(Schema.isMaxLength(30)),
  nextIndex: Schema.NullOr(Schema.Number),
});
export type ChatGeneratedClient = {
  reserve(input: ImageReservation): Promise<{ readonly fresh: boolean }>;
  consume(key: ImageCallKey): Promise<{ readonly dispatch: boolean }>;
  finish(key: ImageCallKey): Promise<{ readonly pendingBytes: number }>;
  receipt(key: ImageOutputKey, expected?: ImageReceiptExpectation): Promise<typeof Receipt.Type>;
  receipts(key: ImageCallKey, after?: number): Promise<typeof Receipts.Type>;
  sink(key: ImageCallKey): ImageHost<SavedFile>["store"];
};
const query = (value: object): string =>
  new URLSearchParams(
    Object.entries(value).map(([key, entry]): [string, string] => [key, String(entry)]),
  ).toString();

/** No transport retries: uncertain mutations can only be repaired through receipt reads. */
export const generatedCatalogRequest = async <S extends Schema.ConstraintDecoder<unknown>>(
  stub: cf.DurableObjectStub,
  path: string,
  init: cf.RequestInit,
  schema: S,
  signal?: AbortSignal,
): Promise<S["Type"]> => {
  let response: cf.Response | undefined;
  const cancel = (): void => {
    const body = response?.body;
    if (body !== undefined && body !== null && !body.locked) {
      try {
        void body.cancel().catch(() => undefined);
      } catch {
        /* Observe cancellation only. */
      }
    }
  };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    signal?.throwIfAborted();
    response = await stub.fetch(`https://chat.internal${path}`, {
      ...init,
      // The Worker uses one native signal; infra also loads Node's incompatible ambient types.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, typescript/no-unnecessary-type-assertion -- same native AbortSignal; needed only under infra's Node ambient types.
      ...(signal === undefined ? {} : { signal: signal as unknown as cf.AbortSignal }),
    });
    if (signal?.aborted) {
      cancel();
      throw new ImageStorageError("unavailable");
    }
    const raw: unknown = await response.json();
    signal?.throwIfAborted();
    if (typeof raw !== "object" || raw === null) throw new ImageStorageError("unavailable");
    if (Reflect.get(raw, "ok") !== true) {
      throw new ImageStorageError(
        decodeOption(ImageStorageFailureCode, Reflect.get(raw, "code")) ?? "unavailable",
      );
    }
    const value = decodeOption(schema, Reflect.get(raw, "value"));
    if (value === null || !response.ok) throw new ImageStorageError("unavailable");
    return value;
  } catch (error) {
    if (error instanceof ImageStorageError) throw error;
    throw new ImageStorageError("unavailable");
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
};

/** Optional recovery signal scopes reads/finish ONLY; normal paid-output persistence is unchanged. */
export const createChatGeneratedClient = (
  stub: cf.DurableObjectStub,
  recoverySignal?: AbortSignal,
): ChatGeneratedClient => {
  const post = <S extends Schema.ConstraintDecoder<unknown>>(
    path: string,
    body: unknown,
    schema: S,
    signal?: AbortSignal,
  ) =>
    generatedCatalogRequest(
      stub,
      `/files/generated/${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      schema,
      signal,
    );
  const receipt: ChatGeneratedClient["receipt"] = (key, expected) =>
    generatedCatalogRequest(
      stub,
      `/files/generated/receipt?${query({ ...key, ...expected })}`,
      { method: "GET" },
      Receipt,
      recoverySignal,
    );
  return {
    reserve: (input) => post("reserve", input, Schema.Struct({ fresh: Schema.Boolean })),
    consume: (key) => post("consume", key, Schema.Struct({ dispatch: Schema.Boolean })),
    finish: (key) =>
      post("finish", key, Schema.Struct({ pendingBytes: Schema.Number }), recoverySignal),
    receipt,
    receipts: (key, after) =>
      generatedCatalogRequest(
        stub,
        `/files/generated/receipts?${query({ ...key, ...(after === undefined ? {} : { after }) })}`,
        { method: "GET" },
        Receipts,
        recoverySignal,
      ),
    sink: (key) => async (output, index, context) => {
      if (context.signal.aborted) throw new ImageStorageError("not_admitted");
      const buffer = output.bytes.buffer;
      if (!(buffer instanceof ArrayBuffer)) throw new ImageStorageError("invalid_output");
      // Borrow this exact range until the sink settles; never mutate caller bytes.
      const bytes = new Uint8Array(buffer, output.bytes.byteOffset, output.bytes.byteLength);
      if (
        bytes.byteLength === 0 ||
        bytes.byteLength > MAX_IMAGE_BYTES ||
        context.descriptor.index !== index ||
        context.descriptor.bytes !== bytes.byteLength ||
        context.descriptor.mimeType !== output.mimeType
      )
        throw new ImageStorageError("invalid_output");
      const hash = await crypto.subtle.digest("SHA-256", bytes);
      const expected = decodeOption(ImageReceiptExpectation, {
        digest: Array.from(new Uint8Array(hash), (n) => n.toString(16).padStart(2, "0")).join(""),
        total: context.total,
        byteSize: bytes.byteLength,
        mediaType: output.mimeType,
      });
      if (expected === null) throw new ImageStorageError("invalid_output");
      if (context.signal.aborted) throw new ImageStorageError("not_admitted");
      try {
        // Do not bind the request to Stop once persistence has begun.
        return await generatedCatalogRequest(
          stub,
          `/files/generated/output?${query({ ...key, index, total: context.total })}`,
          {
            method: "PUT",
            headers: {
              "content-type": output.mimeType,
              "x-image-byte-size": String(bytes.byteLength),
            },
            body: bytes,
          },
          SavedFile,
        );
      } catch (error) {
        if (
          !(error instanceof ImageStorageError) ||
          (error.code !== "unavailable" && error.code !== "unresolved")
        )
          throw error;
        const existing = await receipt({ ...key, index }, expected);
        if (existing.file !== null) return existing.file;
        throw new ImageStorageError("unresolved");
      }
    },
  };
};
