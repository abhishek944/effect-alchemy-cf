import type * as cf from "@cloudflare/workers-types";
import { WorkerEnvironment } from "alchemy/Cloudflare";
import { Effect, Schema } from "effect";
import { officeAttachmentIds, officeImportOptions, safeFailure } from "@starter/office-contract";
import { CurrentOfficeSession } from "./office-authentication.ts";
import { ChatNamespaces, ChatNamespacesLive, doCall } from "./chat-bindings.ts";
import { requireOwnedChat } from "./chat-http-read.ts";
import { SavedOriginalMetadata } from "./chat-library-original.ts";
import { chatFilesObjectScope, retainedObjectKey } from "./chat-files-store.ts";
import { statFileObject, openFileObject } from "./chat-file-io-objects.ts";
import { holdFileBody } from "./chat-file-io-body.ts";
import { officeHostFetch, officeInvocation, type OfficeDispatch } from "./office-http-call.ts";
import { officeUploadReply } from "./office-http-upload.ts";
import { reportOfficeHttpFailure } from "./office-http-failure.ts";
import {
  officeErrorFromFailure,
  officeFailure,
  officeJson,
  officeJsonValue,
  officeReadBytes,
  unavailable,
} from "./office-http-model.ts";

const OriginalReply = Schema.Struct({ ok: Schema.Literal(true), value: SavedOriginalMetadata });
const isBucket = (value: unknown): value is cf.R2Bucket =>
  typeof value === "object" &&
  value !== null &&
  "get" in value &&
  typeof value.get === "function" &&
  "head" in value &&
  typeof value.head === "function";

/** Human-authorized original staging: no browser byte roundtrip or invented task identity. */
export const stageOfficeOriginal = (
  dispatch: OfficeDispatch,
  input: { readonly chatId: string; readonly fileRef: string },
  signal: AbortSignal,
) =>
  Effect.gen(function* () {
    const session = yield* CurrentOfficeSession;
    const ns = yield* ChatNamespaces;
    const chat = yield* requireOwnedChat(ns, session.ownerId, input.chatId).pipe(
      Effect.mapError(unavailable),
    );
    if (chat.archived)
      return yield* Effect.fail(officeErrorFromFailure(safeFailure("NOT_EDITABLE")));
    const stub = ns.catalog(session.ownerId);
    const query = new URLSearchParams({ chatId: input.chatId, fileId: input.fileRef });
    const originalResponse = yield* doCall(
      stub,
      "GET",
      `/files/original-metadata?${query.toString()}`,
      undefined,
      undefined,
      signal,
    ).pipe(Effect.mapError(unavailable));
    if (originalResponse.status === 404)
      return yield* Effect.fail(officeErrorFromFailure(safeFailure("NOT_FOUND")));
    if (originalResponse.status !== 200) return yield* Effect.fail(unavailable());
    const { value: metadata } = yield* Schema.decodeUnknownEffect(OriginalReply)(
      originalResponse.body,
    ).pipe(Effect.mapError(unavailable));
    const file = metadata.file;
    if (
      file.id !== input.fileRef ||
      file.chatId !== input.chatId ||
      file.state !== "ready" ||
      file.expiresAt !== null ||
      officeImportOptions(file.mediaType, file.name) === null
    )
      return yield* Effect.fail(officeErrorFromFailure(safeFailure("INVALID_INPUT")));
    const env: Readonly<Record<string, unknown>> = yield* WorkerEnvironment;
    const bucket = env.CHAT_FILES;
    if (!isBucket(bucket)) return yield* Effect.fail(unavailable());
    const key = retainedObjectKey(chatFilesObjectScope(stub), file.chatId, file.id);
    const upload = {
      operationId: officeAttachmentIds(file.id).uploadId,
      kind: "upload" as const,
      filename: file.name,
      bytes: file.byteSize,
      digest: metadata.digest,
    };
    // Acquire authority before opening the body; release always joins the original stream.
    const invocationId = yield* officeInvocation(dispatch);
    return yield* Effect.acquireUseRelease(
      Effect.tryPromise({
        try: async () => {
          signal.throwIfAborted();
          const head = await statFileObject(bucket, key, file);
          if (head === null) throw unavailable();
          const object = await openFileObject(bucket, key, head, file);
          if (object === null) throw unavailable();
          const held = await holdFileBody(object.body, file.byteSize, signal);
          if (
            object.key !== key ||
            (object.httpMetadata?.contentEncoding !== undefined &&
              object.httpMetadata.contentEncoding !== "identity") ||
            (object.customMetadata?.digest !== undefined &&
              object.customMetadata.digest !== metadata.digest)
          ) {
            await held.cancel();
            throw unavailable();
          }
          return held;
        },
        catch: unavailable,
      }),
      (held) =>
        Effect.gen(function* () {
          const response = yield* officeHostFetch(dispatch, session, `/upload/${invocationId}`, {
            method: "POST",
            headers: {
              "content-type": "application/octet-stream",
              "x-office-upload": JSON.stringify(upload),
            },
            body: held.body,
            signal,
          });
          const raw = officeJsonValue(yield* officeReadBytes(response, 64 * 1024));
          const ref = officeUploadReply(upload, raw);
          if (response.status !== 200 || ref === null || ref.id !== upload.operationId)
            return yield* Effect.fail(unavailable());
          return officeJson(ref);
        }),
      (held) => Effect.promise(() => held.cancel()),
    );
  }).pipe(
    Effect.provide(ChatNamespacesLive),
    Effect.tapCause((cause) => reportOfficeHttpFailure(cause, "original.stage")),
    Effect.catch((error) => Effect.succeed(officeFailure(error))),
  );
