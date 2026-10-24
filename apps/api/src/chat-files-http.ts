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
import { reportFailure, type FailureContext } from "@starter/diagnostics";
import { decodeOption, json } from "./chat-internal.ts";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import type { ChatFilesCatalogClient } from "./chat-files-client.ts";
import { uploadChatFile } from "./chat-file-io-upload.ts";
import { serveFileOriginal } from "./chat-file-io-response.ts";
import { publicFail } from "./chat-files-public.ts";
import type { ChatFilesResult } from "./chat-files-model.ts";
import { deleteStoredObjects, retainedObjectKey, stagingObjectKey } from "./chat-files-store.ts";

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
  readonly diagnostic: Omit<FailureContext, "component" | "operation">;
  readonly route: ChatFilesRouteMatch;
  readonly ownerId: string;
  readonly bucket: cf.R2Bucket | undefined;
  readonly catalog: ChatFilesCatalogClient | undefined;
};

const fail = publicFail;

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
  if (found.value.chatId !== input.route.chatId || found.value.id !== input.fileId)
    return fail("unavailable", 503);
  return serveFileOriginal(
    input.request,
    found.value,
    input.bucket,
    [
      stagingObjectKey(input.catalog.scope, input.route.chatId, input.fileId),
      retainedObjectKey(input.catalog.scope, input.route.chatId, input.fileId),
    ],
    input.diagnostic,
  );
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
  ]).catch((cause) => {
    // Removal already succeeded; report the orphaned-byte disposition once.
    reportFailure(cause, {
      ...input.diagnostic,
      chatId: input.route.chatId,
      component: "chat-files",
      operation: "attachments.remove",
      event: "application.cleanup",
      reason: "cleanup",
    });
  });
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
  if (input.request.method === "POST") return await uploadChatFile(bound);
  if (input.request.method === "GET" || input.request.method === "HEAD")
    return await readOriginal(bound);
  if (input.request.method === "DELETE") return await remove(bound);
  return fail("invalid_input", 405);
};
