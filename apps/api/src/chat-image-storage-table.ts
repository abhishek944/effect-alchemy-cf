import type { ChatSqlStorage } from "./chat-ledger.ts";
import type { ImageReservation, ImageCallKey } from "./chat-image-storage-schema.ts";

export type ImageCallRow = {
  call_id: string;
  chat_id: string;
  operation_id: string;
  request_json: string;
  remaining_bytes: number;
  state: "reserved" | "running" | "finished";
};
export type ImageOutputRow = {
  call_id: string;
  output_index: number;
  file_id: string;
  digest: string;
  byte_size: number;
  media_type: string;
  width: number;
  height: number;
  total: number;
  state: "pending" | "accepted";
  created_at: number;
};

export const ensureImageStorageSchema = (db: ChatSqlStorage): void => {
  db.exec(`CREATE TABLE IF NOT EXISTS image_calls (
    call_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    request_json TEXT NOT NULL, remaining_bytes INTEGER NOT NULL CHECK(remaining_bytes >= 0),
    state TEXT NOT NULL, created_at INTEGER NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS image_outputs (
    call_id TEXT NOT NULL, output_index INTEGER NOT NULL, file_id TEXT NOT NULL UNIQUE,
    digest TEXT NOT NULL, byte_size INTEGER NOT NULL, media_type TEXT NOT NULL,
    width INTEGER NOT NULL, height INTEGER NOT NULL, total INTEGER NOT NULL,
    state TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(call_id, output_index)
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS image_outputs_receipts ON image_outputs(call_id, state)`);
};

export const imageCall = (db: ChatSqlStorage, key: ImageCallKey): ImageCallRow | null =>
  db
    .exec<ImageCallRow>(
      `SELECT * FROM image_calls WHERE call_id = ? AND chat_id = ?`,
      key.callId,
      key.chatId,
    )
    .toArray()[0] ?? null;

export const imageOutput = (
  db: ChatSqlStorage,
  callId: string,
  index: number,
): ImageOutputRow | null =>
  db
    .exec<ImageOutputRow>(
      `SELECT * FROM image_outputs WHERE call_id = ? AND output_index = ?`,
      callId,
      index,
    )
    .toArray()[0] ?? null;

export const pendingImageBytes = (db: ChatSqlStorage, callId: string): number =>
  db
    .exec<{ bytes: number }>(
      `SELECT COALESCE(SUM(byte_size), 0) AS bytes FROM image_outputs
     WHERE call_id = ? AND state = 'pending'`,
      callId,
    )
    .one().bytes;

export const imageReservationJson = (input: ImageReservation): string =>
  JSON.stringify({
    chatId: input.chatId,
    callId: input.callId,
    operationId: input.operationId,
    requestDigest: input.requestDigest,
    maxOutputBytes: input.maxOutputBytes,
    sources: input.sources,
    model: input.model,
    size: input.size,
    quality: input.quality,
  });

export const insertImageCall = (db: ChatSqlStorage, input: ImageReservation): void => {
  db.exec(
    `INSERT INTO image_calls VALUES (?, ?, ?, ?, ?, 'reserved', ?)`,
    input.callId,
    input.chatId,
    input.operationId,
    imageReservationJson(input),
    input.maxOutputBytes,
    Date.now(),
  );
};
