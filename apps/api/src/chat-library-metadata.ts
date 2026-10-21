import type { ChatSqlStorage } from "./chat-ledger.ts";
import { acceptedDescriptor } from "./chat-files-model.ts";
import { fileRow } from "./chat-files-table.ts";
import { decodeOption } from "./chat-internal.ts";
import { ImageReservation, ImageStorageError } from "./chat-image-storage-schema.ts";
import type { SavedFile } from "./chat-library-schema.ts";

/** Accepted identity survives missing original bytes; no historical rows are rewritten. */
export const savedFileMetadata = (
  db: ChatSqlStorage,
  chatId: string,
  fileId: string,
): SavedFile | null => {
  const row = fileRow(db, fileId);
  if (row === null || row.chatId !== chatId || row.state !== "accepted") return null;
  const provenance = db
    .exec<{ request_json: string }>(
      `SELECT c.request_json FROM image_outputs o JOIN image_calls c ON c.call_id = o.call_id
     WHERE o.file_id = ? AND o.state = 'accepted' AND c.chat_id = ?`,
      fileId,
      chatId,
    )
    .toArray()[0];
  if (provenance === undefined)
    return { ...acceptedDescriptor(row), origin: "upload", sources: [], generation: null };
  const request = decodeOption(ImageReservation, JSON.parse(provenance.request_json));
  if (request === null) throw new ImageStorageError("unavailable");
  return {
    ...acceptedDescriptor(row),
    origin: "generated",
    sources: request.sources,
    generation: { callId: request.callId, operationId: request.operationId },
  };
};
