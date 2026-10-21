import type * as cf from "@cloudflare/workers-types";
import { DomainUuid } from "./chat-capabilities.ts";
import { ensureChatFilesSchema } from "./chat-files-table.ts";
import { retainedObjectKey } from "./chat-files-store.ts";
import { digestText } from "./chat-internal.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import { ImageStorageError, requireImageValue } from "./chat-image-storage-schema.ts";
import { decodeLibraryCursor, encodeLibraryCursor } from "./chat-library-cursor.ts";
import { savedFileMetadata } from "./chat-library-metadata.ts";
import { savedOriginalMetadata, type SavedOriginalMetadata } from "./chat-library-original.ts";
import { LibraryQuery, type SavedFile, type SavedLibraryPage } from "./chat-library-schema.ts";

type Options = {
  readonly db: ChatSqlStorage;
  readonly bucket?: cf.R2Bucket;
  readonly scope: string;
};
/** Independent of transcript loading; accepted-only, archive-readable and immutable. */
export class ChatSavedLibrary {
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
    ensureChatFilesSchema(options.db);
    options.db.exec(
      `CREATE INDEX IF NOT EXISTS files_library_time ON files(chat_id, state, created_at, file_id)`,
    );
    options.db.exec(
      `CREATE INDEX IF NOT EXISTS files_library_name ON files(chat_id, state, lower(name), file_id)`,
    );
  }
  private async availability(file: SavedFile): Promise<SavedFile> {
    const bucket = this.options.bucket;
    if (bucket === undefined) return { ...file, state: "unavailable" };
    try {
      const head = await bucket.head(retainedObjectKey(this.options.scope, file.chatId, file.id));
      return head !== null && head.size === file.byteSize
        ? file
        : { ...file, state: "unavailable" };
    } catch {
      return { ...file, state: "unavailable" };
    }
  }
  async get(chatId: string, fileId: string): Promise<SavedFile | null> {
    requireImageValue(DomainUuid, chatId);
    requireImageValue(DomainUuid, fileId);
    const file = savedFileMetadata(this.options.db, chatId, fileId);
    return file === null ? null : this.availability(file);
  }
  /** Private accepted authority for bounded original loaders; does not read or allocate bytes. */
  original(chatId: string, fileId: string): SavedOriginalMetadata | null {
    requireImageValue(DomainUuid, chatId);
    requireImageValue(DomainUuid, fileId);
    return savedOriginalMetadata(this.options.db, chatId, fileId);
  }
  async list(chatId: string, input: LibraryQuery = {}): Promise<SavedLibraryPage> {
    requireImageValue(DomainUuid, chatId);
    const query = requireImageValue(LibraryQuery, input);
    const search = query.search ?? "";
    const kind = query.kind ?? "all";
    const origin = query.origin ?? "all";
    const sort = query.sort ?? "newest";
    const limit = query.limit ?? 30;
    const fingerprint = await digestText(JSON.stringify([chatId, search, kind, origin, sort]));
    const cursor =
      query.cursor === undefined ? null : decodeLibraryCursor(query.cursor, fingerprint);
    const where = ["f.chat_id = ?", "f.state = 'accepted'"];
    const params: (string | number)[] = [chatId];
    if (kind !== "all") {
      where.push("f.kind = ?");
      params.push(kind);
    }
    if (origin !== "all") {
      where.push(origin === "generated" ? "o.file_id IS NOT NULL" : "o.file_id IS NULL");
    }
    if (search !== "") {
      where.push("instr(lower(f.name), lower(?)) > 0");
      params.push(search);
    }
    const column = sort === "name" ? "lower(f.name)" : "f.created_at";
    const direction = sort === "newest" ? "DESC" : "ASC";
    if (cursor !== null) {
      where.push(
        `(${column} ${sort === "newest" ? "<" : ">"} ? OR (${column} = ? AND f.file_id > ?))`,
      );
      const key = sort === "name" ? cursor.name : cursor.time;
      params.push(key, key, cursor.id);
    }
    const rows = this.options.db
      .exec<{ file_id: string; created_at: number; sort_name: string }>(
        `SELECT f.file_id, f.created_at, lower(f.name) AS sort_name FROM files f
       LEFT JOIN image_outputs o ON o.file_id = f.file_id AND o.state = 'accepted'
       WHERE ${where.join(" AND ")} ORDER BY ${column} ${direction}, f.file_id ASC LIMIT ?`,
        ...params,
        limit + 1,
      )
      .toArray();
    const files: SavedFile[] = [];
    for (const row of rows.slice(0, limit)) {
      const file = savedFileMetadata(this.options.db, chatId, row.file_id);
      if (file === null) throw new ImageStorageError("unavailable");
      files.push(await this.availability(file));
    }
    const last = rows[Math.min(rows.length, limit) - 1];
    const nextCursor =
      rows.length > limit && last !== undefined
        ? encodeLibraryCursor({
            query: fingerprint,
            id: last.file_id,
            time: last.created_at,
            name: last.sort_name,
          })
        : null;
    return { chatId, files, nextCursor };
  }
}
