import type * as cf from "@cloudflare/workers-types";
import type { AgentContext } from "agents";
import type { ImageStoreContext, Original } from "@abhishek944/pi-image-gen/core";
import { ensureChatFilesSchema } from "./chat-files-table.ts";
import { readBoundedBody } from "./body-limit.ts";
import { generatedDeclaredBytes, persistGeneratedOutput } from "./chat-generated-output.ts";
import { retainedObjectKey } from "./chat-files-store.ts";
import { ChatImageStorageLedger } from "./chat-image-storage-ledger.ts";
import {
  ImageCallKey,
  ImageOutputKey,
  ImageReceiptExpectation,
  ImageReservation,
  ImageStoreQuery,
  ImageStorageError,
  requireImageValue,
} from "./chat-image-storage-schema.ts";
import { imageCall, imageOutput, type ImageOutputRow } from "./chat-image-storage-table.ts";
import type { SavedFile } from "./chat-library-schema.ts";

export type GeneratedReceipt = {
  readonly index: number;
  readonly state: "accepted" | "unresolved";
  readonly file: SavedFile | null;
};
export type GeneratedReceipts = {
  readonly state: "reserved" | "running" | "finished";
  readonly outputs: readonly GeneratedReceipt[];
  readonly nextIndex: number | null;
};
export type ChatGeneratedStorageOptions = {
  readonly storage: AgentContext["storage"];
  readonly bucket: cf.R2Bucket;
  readonly scope: string;
  /** Authoritative owner chat lookup, false for missing/archived chats. */
  readonly canGenerate: (chatId: string) => boolean;
};

/** Owner-local quota/admission and immutable private originals; no provider logic. */
export class ChatGeneratedStorage {
  private readonly ledger: ChatImageStorageLedger;
  private readonly options: ChatGeneratedStorageOptions;
  constructor(options: ChatGeneratedStorageOptions) {
    this.options = options;
    ensureChatFilesSchema(options.storage.sql);
    this.ledger = new ChatImageStorageLedger(options.storage, options.canGenerate);
  }
  reserve(input: ImageReservation): { fresh: boolean } {
    const value = requireImageValue(ImageReservation, input);
    return this.ledger.reserve(value);
  }
  /** Only dispatch:true may enter the package engine, exactly once. Lost ack means READ, not replay. */
  consume(key: ImageCallKey): { dispatch: boolean } {
    const value = requireImageValue(ImageCallKey, key);
    return this.ledger.consume(value);
  }
  finish(key: ImageCallKey): { pendingBytes: number } {
    const value = requireImageValue(ImageCallKey, key);
    return this.ledger.finish(value);
  }
  private persist(
    key: ImageCallKey,
    output: Original,
    index: number,
    context: ImageStoreContext,
  ): Promise<SavedFile> {
    return persistGeneratedOutput(
      {
        ledger: this.ledger,
        bucket: this.options.bucket,
        scope: this.options.scope,
        receipt: (input, expected) => this.receipt(input, expected),
      },
      key,
      output,
      index,
      context,
    );
  }
  /** Private ingress keeps running-call authorization and durable output quota. */
  async ingest(input: ImageStoreQuery, request: Request): Promise<SavedFile> {
    const key = requireImageValue(ImageStoreQuery, input);
    const declared = generatedDeclaredBytes(request);
    if (imageCall(this.options.storage.sql, key)?.state !== "running")
      throw new ImageStorageError("not_admitted");
    if (declared > this.ledger.request(key).maxOutputBytes)
      throw new ImageStorageError("invalid_output");
    const bytes = await readBoundedBody(request, declared);
    if (bytes === null || bytes.byteLength !== declared)
      throw new ImageStorageError("invalid_output");
    const mimeType = request.headers.get("content-type") ?? "";
    return this.persist(key, { bytes, mimeType }, key.index, {
      total: key.total,
      signal: request.signal,
      descriptor: { index: key.index, bytes: declared, mimeType },
    });
  }
  private objectKey(key: ImageCallKey, row: ImageOutputRow): string {
    return retainedObjectKey(this.options.scope, key.chatId, row.file_id);
  }
  /** Existing-result repair performs HEAD plus idempotent SQL acceptance, never PUT/provider I/O. */
  async receipt(
    input: ImageOutputKey,
    expected?: ImageReceiptExpectation,
  ): Promise<GeneratedReceipt> {
    const key = requireImageValue(ImageOutputKey, input);
    const identity =
      expected === undefined ? undefined : requireImageValue(ImageReceiptExpectation, expected);
    this.ledger.request(key);
    const row = imageOutput(this.options.storage.sql, key.callId, key.index);
    if (row === null) return { index: key.index, state: "unresolved", file: null };
    if (
      identity !== undefined &&
      (row.digest !== identity.digest ||
        row.total !== identity.total ||
        row.byte_size !== identity.byteSize ||
        row.media_type !== identity.mediaType)
    )
      throw new ImageStorageError("conflict");
    const head = await this.options.bucket.head(this.objectKey(key, row)).catch(() => null);
    if (
      head === null ||
      head.size !== row.byte_size ||
      head.customMetadata?.digest !== row.digest ||
      head.customMetadata?.fileId !== row.file_id ||
      head.customMetadata?.chatId !== key.chatId
    ) {
      if (row.state === "accepted") {
        const file = this.ledger.accept(key, row);
        return { index: key.index, state: "accepted", file: { ...file, state: "unavailable" } };
      }
      return { index: key.index, state: "unresolved", file: null };
    }
    return { index: key.index, state: "accepted", file: this.ledger.accept(key, row) };
  }
  /** One bounded page, including unresolved identities; a caller explicitly requests further reads. */
  async receipts(input: ImageCallKey, after = -1): Promise<GeneratedReceipts> {
    const key = requireImageValue(ImageCallKey, input);
    if (!Number.isSafeInteger(after) || after < -1) throw new ImageStorageError("invalid_input");
    const call = imageCall(this.options.storage.sql, key);
    if (call === null) throw new ImageStorageError("not_admitted");
    const rows = this.options.storage.sql
      .exec<{ output_index: number }>(
        `SELECT output_index FROM image_outputs WHERE call_id = ? AND output_index > ?
       ORDER BY output_index LIMIT 31`,
        key.callId,
        after,
      )
      .toArray();
    const outputs: GeneratedReceipt[] = [];
    for (const row of rows.slice(0, 30))
      outputs.push(await this.receipt({ ...key, index: row.output_index }));
    return {
      state: call.state,
      outputs,
      nextIndex: rows.length > 30 ? (rows[29]?.output_index ?? null) : null,
    };
  }
}
