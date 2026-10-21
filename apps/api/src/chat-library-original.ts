import { Schema } from "effect";
import { DomainUuid } from "./chat-capabilities.ts";
import { fileRow } from "./chat-files-table.ts";
import { ImageDigest, ImageStorageError } from "./chat-image-storage-schema.ts";
import { decodeOption } from "./chat-internal.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import { savedFileMetadata } from "./chat-library-metadata.ts";
import { SavedFile } from "./chat-library-schema.ts";

/** Server-only original authority. Never serialize this envelope through a public file endpoint. */
export const SavedOriginalMetadata = Schema.Struct({
  file: SavedFile,
  digest: ImageDigest,
  originOperationId: Schema.NullOr(DomainUuid),
});
export type SavedOriginalMetadata = typeof SavedOriginalMetadata.Type;

/** Accepted metadata only: no R2 I/O, byte allocation, fallback to staged rows or rebinding. */
export const savedOriginalMetadata = (
  db: ChatSqlStorage,
  chatId: string,
  fileId: string,
): SavedOriginalMetadata | null => {
  const row = fileRow(db, fileId);
  if (row === null || row.chatId !== chatId || row.state !== "accepted") return null;
  const file = savedFileMetadata(db, chatId, fileId);
  if (file === null) throw new ImageStorageError("unavailable");
  const metadata = decodeOption(SavedOriginalMetadata, {
    file,
    digest: row.digest,
    originOperationId: row.operationId,
  });
  if (metadata === null) throw new ImageStorageError("unavailable");
  return metadata;
};
