/**
 * Worker HTTP boundary for private chat attachments.
 *
 * `ownerId` is supplied by the authenticated parent layer; this module never
 * reads an owner claim from the request. Bodies stream through the exact
 * per-kind limit before validation, and every accepted byte is written to the
 * owner-scoped staging key before metadata becomes `ready`. Responses are JSON
 * descriptors or original bytes only: no keys, no base64, no public URL.
 *
 * Public contract (frozen UI assignment, one shape only): a successful upload
 * returns the bare `FileDescriptor`, a successful delete returns `{ ok: true }`,
 * and every failure returns `{ code, message }` with a safe human message.
 * Private `/files/*` envelopes stay internal to the catalog client.
 */
import type * as cf from "@cloudflare/workers-types";
import { decodeOption, json } from "./chat-internal.ts";
import {
  type FileDescriptor,
  FileName,
  MAX_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
} from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { readBoundedBody } from "./body-limit.ts";
import type { ChatFilesCatalogClient } from "./chat-files-client.ts";
import { resolveMedia, validateFileBytes } from "./chat-files-media.ts";
import { publicFail } from "./chat-files-public.ts";
import type { ChatFilesFailure, ChatFilesResult } from "./chat-files-model.ts";
import {
  deleteStoredObjects,
  originalResponse,
  putStagedObject,
  readOwnedOriginal,
  retainedObjectKey,
  stagingObjectKey,
} from "./chat-files-store.ts";

export type ChatFilesRouteMatch = {
  readonly chatId: string;
  readonly fileId: string | null;
};

const ROUTE = /^\/api\/chats\/([^/]+)\/attachments(?:\/([^/]+))?$/;

export const matchChatFilesRoute = (pathname: string): ChatFilesRouteMatch | null => {
  const match = ROUTE.exec(pathname);
  const chatId = decodeOption(DomainUuid, match?.[1]);
  if (match === null || chatId === null) return null;
  const rawFileId = match[2];
  if (rawFileId === undefined) return { chatId, fileId: null };
  const fileId = decodeOption(DomainUuid, rawFileId);
  return fileId === null ? null : { chatId, fileId };
};

export type ChatFilesRequestInput = {
  readonly request: Request;
  readonly route: ChatFilesRouteMatch;
  readonly ownerId: string;
  readonly bucket: cf.R2Bucket | undefined;
  readonly catalog: ChatFilesCatalogClient | undefined;
};

const fail = publicFail;

const validationStatus = (code: ChatFilesFailure): number =>
  code === "file_too_large" ? 413 : code === "unsupported_type" ? 415 : 422;

const reserveStatus = (code: ChatFilesFailure): number => {
  if (code === "quota_exceeded") return 507;
  if (code === "unavailable") return 503;
  if (code === "attachment_retired") return 410;
  return code === "invalid_input" ? 400 : 409;
};

const upload = async (
  input: ChatFilesRequestInput & {
    readonly bucket: cf.R2Bucket;
    readonly catalog: ChatFilesCatalogClient;
    readonly fileId: string;
  },
): Promise<Response> => {
  const rawName = input.request.headers.get("x-file-name");
  let name: string | null = null;
  try {
    name = rawName === null ? null : decodeURIComponent(rawName);
  } catch {
    return fail("invalid_input", 400);
  }
  const decodedName = decodeOption(FileName, name);
  if (decodedName === null) return fail("invalid_input", 400);
  const media = resolveMedia(decodedName);
  if (media === null) return fail("unsupported_type", 415);
  const limit = media.kind === "image" ? MAX_IMAGE_BYTES : MAX_TEXT_FILE_BYTES;
  const bytes = await readBoundedBody(input.request, limit);
  if (bytes === null) return fail("file_too_large", 413);
  const validated = await validateFileBytes(decodedName, bytes);
  if (!validated.ok) return fail(validated.code, validationStatus(validated.code));
  const now = Date.now();
  const reserved = await input.catalog.reserve({
    fileId: input.fileId,
    chatId: input.route.chatId,
    kind: validated.value.kind,
    name: decodedName,
    mediaType: validated.value.mediaType,
    byteSize: bytes.byteLength,
    digest: validated.value.digest,
    width: validated.value.width,
    height: validated.value.height,
    excerpt: validated.value.excerpt,
    now,
  });
  if (!reserved.ok) return fail(reserved.code, reserveStatus(reserved.code));
  if (reserved.value.status === "existing") return json(reserved.value.file);
  const key = stagingObjectKey(input.catalog.scope, input.route.chatId, input.fileId);
  try {
    await putStagedObject(input.bucket, key, bytes, {
      contentType: validated.value.mediaType,
      fileId: input.fileId,
      chatId: input.route.chatId,
      name: decodedName,
      digest: validated.value.digest,
    });
  } catch {
    await input.catalog
      .abort({ fileId: input.fileId, chatId: input.route.chatId, now: Date.now() })
      .catch(() => undefined);
    return fail("unavailable", 503);
  }
  const staged = await input.catalog.staged({
    fileId: input.fileId,
    chatId: input.route.chatId,
    now: Date.now(),
  });
  if (!staged.ok) {
    await deleteStoredObjects(input.bucket, [key]).catch(() => undefined);
    return fail("unavailable", 503);
  }
  return json(staged.value);
};

const readOriginal = async (
  input: ChatFilesRequestInput & {
    readonly bucket: cf.R2Bucket;
    readonly catalog: ChatFilesCatalogClient;
    readonly fileId: string;
  },
): Promise<Response> => {
  const found: ChatFilesResult<FileDescriptor> = await input.catalog.get(
    input.route.chatId,
    input.fileId,
  );
  if (!found.ok) return fail(found.code, found.code === "attachment_not_ready" ? 404 : 503);
  if (found.value.state !== "ready") return fail("attachment_not_ready", 410);
  const bytes = await readOwnedOriginal(
    input.bucket,
    input.catalog.scope,
    input.route.chatId,
    input.fileId,
  );
  if (bytes === null) return fail("attachment_not_ready", 410);
  return originalResponse(input.request, found.value, bytes);
};

const remove = async (
  input: ChatFilesRequestInput & {
    readonly bucket: cf.R2Bucket;
    readonly catalog: ChatFilesCatalogClient;
    readonly fileId: string;
  },
): Promise<Response> => {
  const removed = await input.catalog.remove({
    chatId: input.route.chatId,
    fileId: input.fileId,
    now: Date.now(),
  });
  if (!removed.ok) return fail(removed.code, 503);
  if (removed.value === "not_found") return fail("attachment_not_ready", 404);
  if (removed.value === "in_use") return fail("attachment_in_use", 409);
  await deleteStoredObjects(input.bucket, [
    stagingObjectKey(input.catalog.scope, input.route.chatId, input.fileId),
    retainedObjectKey(input.catalog.scope, input.route.chatId, input.fileId),
  ]).catch(() => undefined);
  return json({ ok: true });
};
/** Handles one matched attachment request; returns a response for every method. */
export const handleChatFilesRequest = async (input: ChatFilesRequestInput): Promise<Response> => {
  if (input.route.fileId === null) return fail("invalid_input", 405);
  if (input.bucket === undefined || input.catalog === undefined) return fail("unavailable", 503);
  const bound = {
    ...input,
    bucket: input.bucket,
    catalog: input.catalog,
    fileId: input.route.fileId,
  };
  if (input.request.method === "POST") return await upload(bound);
  if (input.request.method === "GET" || input.request.method === "HEAD")
    return await readOriginal(bound);
  if (input.request.method === "DELETE") return await remove(bound);
  return fail("invalid_input", 405);
};
