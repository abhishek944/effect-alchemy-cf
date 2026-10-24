import type * as cf from "@cloudflare/workers-types";
import type { ChatFilesRequestInput } from "./chat-files-http.ts";
import type { ChatFilesCatalogClient } from "./chat-files-client.ts";
import { FileName } from "./chat-attachment-schema.ts";
import { readBoundedBody } from "./body-limit.ts";
import { decodeOption, json } from "./chat-internal.ts";
import { resolveMedia, validateFileBytes } from "./chat-files-media.ts";
import { publicFail } from "./chat-files-public.ts";
import type { ChatFilesFailure } from "./chat-files-model.ts";
import { deleteStoredObjects, putStagedObject, stagingObjectKey } from "./chat-files-store.ts";
import { fileByteLimit } from "./chat-file-io-limits.ts";

const reserveStatus = (code: ChatFilesFailure): number => {
  if (code === "quota_exceeded") return 507;
  if (code === "unavailable") return 503;
  if (code === "attachment_retired") return 410;
  return code === "invalid_input" ? 400 : 409;
};
const validationStatus = (code: ChatFilesFailure): number =>
  code === "file_too_large" ? 413 : code === "unsupported_type" ? 415 : 422;

/** Authentication precedes the bounded read/hash/PUT/catalog operation. */
export const uploadChatFile = async (
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
    return publicFail("invalid_input", 400);
  }
  const decodedName = decodeOption(FileName, name);
  if (decodedName === null) return publicFail("invalid_input", 400);
  const media = resolveMedia(decodedName);
  if (media === null) return publicFail("unsupported_type", 415);
  const limit = fileByteLimit(media.kind);
  const rawLength = input.request.headers.get("content-length");
  if (rawLength !== null && !/^[0-9]{1,16}$/.test(rawLength))
    return publicFail("invalid_input", 400);
  const declared = rawLength === null ? null : Number(rawLength);
  if (declared !== null && declared > limit) return publicFail("file_too_large", 413);
  const capacity = declared ?? limit;
  try {
    const bytes = await readBoundedBody(input.request, capacity);
    if (bytes === null) return publicFail("file_too_large", 413);
    if (declared !== null && bytes.byteLength !== declared)
      return publicFail("invalid_content", 422);
    const validated = await validateFileBytes(decodedName, bytes);
    if (!validated.ok) return publicFail(validated.code, validationStatus(validated.code));
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
    if (!reserved.ok) return publicFail(reserved.code, reserveStatus(reserved.code));
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
      return publicFail("unavailable", 503);
    }
    const staged = await input.catalog.staged({
      fileId: input.fileId,
      chatId: input.route.chatId,
      now: Date.now(),
    });
    if (!staged.ok) {
      await deleteStoredObjects(input.bucket, [key]).catch(() => undefined);
      return publicFail("unavailable", 503);
    }
    return json(staged.value);
  } catch {
    return publicFail("unavailable", 503);
  }
};
