import type { AgentContext } from "agents";
import { RETAINED_BYTES_PER_USER } from "./chat-attachment-schema.ts";
import { insertUploading, promoteAccepted, clearPurge } from "./chat-files-mutations.ts";
import { fileRow, usageBytes } from "./chat-files-table.ts";
import { savedFileMetadata } from "./chat-library-metadata.ts";
import {
  ImageReservation,
  ImageStorageError,
  requireImageValue,
  type ImageCallKey,
  type ImageStoreQuery,
} from "./chat-image-storage-schema.ts";
import {
  imageCall,
  imageOutput,
  insertImageCall,
  imageReservationJson,
  pendingImageBytes,
  type ImageOutputRow,
} from "./chat-image-storage-table.ts";
import type { ChatFilesReserve } from "./chat-files-ops.ts";
import type { SavedFile } from "./chat-library-schema.ts";

type Storage = AgentContext["storage"];
export class ChatImageStorageLedger {
  private readonly storage: Storage;
  private readonly canGenerate: (id: string) => boolean;
  constructor(storage: Storage, canGenerate: (id: string) => boolean) {
    this.storage = storage;
    this.canGenerate = canGenerate;
  }
  reserve(input: ImageReservation): { fresh: boolean } {
    return this.storage.transactionSync(() => {
      const db = this.storage.sql;
      const existing = imageCall(db, input);
      if (existing !== null) {
        if (existing.request_json !== imageReservationJson(input))
          throw new ImageStorageError("conflict");
        return { fresh: false };
      }
      if (!this.canGenerate(input.chatId)) throw new ImageStorageError("archived");
      for (const id of input.sources) {
        const file = fileRow(db, id);
        if (file?.chatId !== input.chatId || file.state !== "accepted" || file.kind !== "image")
          throw new ImageStorageError("invalid_input");
      }
      const used = usageBytes(db);
      if (
        used.retained + used.staged + used.reserved + used.pending + input.maxOutputBytes >
        RETAINED_BYTES_PER_USER
      )
        throw new ImageStorageError("quota_exceeded");
      // A call id reused in a different chat must never acquire a new reservation.
      const collision = db
        .exec(`SELECT call_id FROM image_calls WHERE call_id = ?`, input.callId)
        .toArray();
      if (collision.length !== 0) throw new ImageStorageError("conflict");
      insertImageCall(db, input);
      return { fresh: true };
    });
  }
  consume(key: ImageCallKey): { dispatch: boolean } {
    return this.storage.transactionSync(() => {
      const row = imageCall(this.storage.sql, key);
      if (row === null) throw new ImageStorageError("not_admitted");
      if (row.state !== "reserved") return { dispatch: false };
      if (!this.canGenerate(key.chatId)) throw new ImageStorageError("archived");
      this.storage.sql.exec(
        `UPDATE image_calls SET state = 'running' WHERE call_id = ?`,
        key.callId,
      );
      return { dispatch: true };
    });
  }
  plan(key: ImageStoreQuery, metadata: ChatFilesReserve): { row: ImageOutputRow; fresh: boolean } {
    return this.storage.transactionSync(() => {
      const db = this.storage.sql;
      const call = imageCall(db, key);
      if (call === null) throw new ImageStorageError("not_admitted");
      const existing = imageOutput(db, key.callId, key.index);
      if (existing !== null) {
        if (
          existing.digest !== metadata.digest ||
          existing.total !== key.total ||
          existing.byte_size !== metadata.byteSize ||
          existing.media_type !== metadata.mediaType
        )
          throw new ImageStorageError("conflict");
        return { row: existing, fresh: false };
      }
      if (call.state !== "running") throw new ImageStorageError("not_admitted");
      const observed = db
        .exec<{ total: number }>(
          `SELECT total FROM image_outputs WHERE call_id = ? LIMIT 1`,
          key.callId,
        )
        .toArray()[0];
      if (key.index >= key.total || (observed !== undefined && observed.total !== key.total))
        throw new ImageStorageError("conflict");
      if (pendingImageBytes(db, key.callId) + metadata.byteSize > call.remaining_bytes)
        throw new ImageStorageError("quota_exceeded");
      db.exec(
        `INSERT INTO image_outputs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        key.callId,
        key.index,
        metadata.fileId,
        metadata.digest,
        metadata.byteSize,
        metadata.mediaType,
        metadata.width,
        metadata.height,
        key.total,
        metadata.now,
      );
      const row = imageOutput(db, key.callId, key.index);
      if (row === null) throw new ImageStorageError("unavailable");
      return { row, fresh: true };
    });
  }
  accept(key: ImageCallKey, output: ImageOutputRow): SavedFile {
    return this.storage.transactionSync(() => {
      const db = this.storage.sql;
      const call = imageCall(db, key);
      const row = imageOutput(db, key.callId, output.output_index);
      if (call === null || row === null) throw new ImageStorageError("not_admitted");
      if (row.state !== "accepted") {
        if (call.remaining_bytes < row.byte_size || fileRow(db, row.file_id) !== null)
          throw new ImageStorageError("conflict");
        const ext = row.media_type === "image/jpeg" ? "jpg" : row.media_type.slice(6);
        insertUploading(db, {
          fileId: row.file_id,
          chatId: key.chatId,
          kind: "image",
          name: `image-${row.output_index + 1}.${ext}`,
          mediaType: row.media_type,
          byteSize: row.byte_size,
          digest: row.digest,
          width: row.width,
          height: row.height,
          excerpt: null,
          now: row.created_at,
        });
        promoteAccepted(db, row.file_id, Date.now(), Date.now());
        clearPurge(db, row.file_id);
        db.exec(
          `UPDATE files SET operation_id = ? WHERE file_id = ?`,
          call.operation_id,
          row.file_id,
        );
        db.exec(
          `UPDATE image_outputs SET state = 'accepted' WHERE call_id = ? AND output_index = ?`,
          key.callId,
          row.output_index,
        );
        db.exec(
          `UPDATE image_calls SET remaining_bytes = remaining_bytes - ? WHERE call_id = ?`,
          row.byte_size,
          key.callId,
        );
      }
      const file = savedFileMetadata(db, key.chatId, row.file_id);
      if (file === null) throw new ImageStorageError("unavailable");
      return file;
    });
  }
  finish(key: ImageCallKey): { pendingBytes: number } {
    return this.storage.transactionSync(() => {
      const db = this.storage.sql;
      if (imageCall(db, key) === null) throw new ImageStorageError("not_admitted");
      const pendingBytes = pendingImageBytes(db, key.callId);
      db.exec(
        `UPDATE image_calls SET state = 'finished', remaining_bytes = ? WHERE call_id = ?`,
        pendingBytes,
        key.callId,
      );
      return { pendingBytes };
    });
  }
  request(key: ImageCallKey): ImageReservation {
    const call = imageCall(this.storage.sql, key);
    if (call === null) throw new ImageStorageError("not_admitted");
    return requireImageValue(ImageReservation, JSON.parse(call.request_json));
  }
}
