/**
 * Retry-safe retention for natively accepted attachments.
 *
 * The parent calls this only after exact native acceptance. Bytes are copied to
 * the retained prefix first, so a crash between copy and commit is repaired by
 * the cleanup probe (which promotes a bound row whose receipt is accepted).
 * Repeating the same operation is a no-op; mismatched operations are rejected
 * by the catalog. Staging bytes are removed only after the commit succeeded.
 */
import type * as cf from "@cloudflare/workers-types";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import { filesFail, filesOk, type ChatFilesResult } from "./chat-files-model.ts";
import {
  copyToRetained,
  deleteStoredObjects,
  retainedObjectKey,
  stagingObjectKey,
} from "./chat-files-store.ts";

export type ChatFilesRetainPort = {
  readonly commit: (input: {
    readonly operationId: string;
    readonly chatId: string;
    readonly fileIds: readonly string[];
    readonly now: number;
  }) => Promise<ChatFilesResult<{ readonly files: readonly FileDescriptor[] }>>;
};

export const retainChatFiles = async (input: {
  readonly bucket: cf.R2Bucket;
  readonly scope: string;
  readonly catalog: ChatFilesRetainPort;
  readonly chatId: string;
  readonly operationId: string;
  readonly fileIds: readonly string[];
  readonly now: number;
}): Promise<ChatFilesResult<readonly FileDescriptor[]>> => {
  for (const fileId of input.fileIds) {
    const from = stagingObjectKey(input.scope, input.chatId, fileId);
    const to = retainedObjectKey(input.scope, input.chatId, fileId);
    if (!(await copyToRetained(input.bucket, from, to))) return filesFail("unavailable");
  }
  const committed = await input.catalog.commit({
    operationId: input.operationId,
    chatId: input.chatId,
    fileIds: input.fileIds,
    now: input.now,
  });
  if (!committed.ok) return committed;
  await deleteStoredObjects(
    input.bucket,
    input.fileIds.map((fileId) => stagingObjectKey(input.scope, input.chatId, fileId)),
  ).catch(() => undefined);
  return filesOk(committed.value.files);
};
