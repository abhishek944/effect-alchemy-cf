import type { AgentContext } from "agents";
import { Option, Schema } from "effect";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { ImageResponseIdentity } from "./chat-image-response-schema.ts";
import type { ImageNativeAccess, ImageNativeContext } from "./chat-image-request-types.ts";
import { imageProofFailure, ImageSafeInteger } from "./chat-image-request-values.ts";

const Era = Schema.Struct({
  version: Schema.Literal(1),
  ownerId: ImageResponseIdentity,
  chatId: ImageResponseIdentity,
  chatScope: ImageResponseIdentity,
  conversationId: ImageResponseIdentity,
  throughEntryId: ImageSafeInteger,
});
type Era = typeof Era.Type;

/** Separate activation metadata: never advances, rewrites old history or grants image authority. */
export class ChatImageLegacyEra {
  private readonly storage: AgentContext["storage"];
  constructor(storage: AgentContext["storage"]) {
    this.storage = storage;
    storage.sql.exec(`CREATE TABLE IF NOT EXISTS chat_image_legacy_era (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1), metadata TEXT NOT NULL
    )`);
    storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS chat_image_legacy_era_no_update
      BEFORE UPDATE ON chat_image_legacy_era BEGIN
      SELECT RAISE(ABORT, 'immutable legacy era'); END`);
    storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS chat_image_legacy_era_no_delete
      BEFORE DELETE ON chat_image_legacy_era BEGIN
      SELECT RAISE(ABORT, 'immutable legacy era'); END`);
  }
  private read(): Era | null {
    try {
      const row = this.storage.sql
        .exec<{ metadata: string }>(
          "SELECT metadata FROM chat_image_legacy_era WHERE singleton = 1",
        )
        .toArray()[0];
      if (row === undefined) return null;
      if (row.metadata.length > 4096) return imageProofFailure();
      const value = Option.getOrNull(
        Schema.decodeUnknownOption(Era, {
          onExcessProperty: "error",
        })(JSON.parse(row.metadata)),
      );
      return value ?? imageProofFailure();
    } catch {
      return imageProofFailure();
    }
  }
  private check(access: ImageNativeAccess, era: Era): Era {
    if (
      access.owner() !== access.ownerId ||
      access.conversationId !== ROOT_CONVERSATION_ID ||
      era.ownerId !== access.ownerId ||
      era.chatId !== access.chatId ||
      era.chatScope !== access.chatScope ||
      era.conversationId !== String(access.conversationId)
    )
      return imageProofFailure();
    return era;
  }
  /** Missing/corrupt activation metadata is never permission for a missing sidecar. */
  boundary(access: ImageNativeAccess): number | null {
    const era = this.read();
    return era === null ? null : this.check(access, era).throughEntryId;
  }
  allows(access: ImageNativeAccess, entryId: number): boolean {
    const through = this.boundary(access);
    return through !== null && Number.isSafeInteger(entryId) && entryId > 0 && entryId <= through;
  }
  /**
   * Parent calls under its real closed admission fence, AFTER pending reconstruction
   * and BEFORE raw resume/recovery that can schedule work or any new candidate writer.
   */
  async initialize(
    access: ImageNativeAccess,
    context: ImageNativeContext,
    closed: () => boolean,
  ): Promise<number> {
    const requireClosed = (): void => {
      context.abortSignal?.throwIfAborted();
      if (
        access.ready() ||
        !closed() ||
        access.owner() !== access.ownerId ||
        access.conversationId !== ROOT_CONVERSATION_ID
      )
        imageProofFailure();
    };
    requireClosed();
    const known = this.read();
    if (known !== null) return this.check(access, known).throughEntryId;
    // Never capture over unresolved candidates or an unfinished bounded pending scan.
    const pending = access.responses.unbound(undefined, 1);
    if (pending.operationIds.length !== 0 || pending.nextCursor !== null) imageProofFailure();
    const root = await access.storage.conversation(access.conversationId, context);
    requireClosed();
    let throughEntryId: number = 0;
    if (root !== undefined) {
      if (root.id !== access.conversationId) imageProofFailure();
      const page = await access.storage.scanEntries(
        { conversationId: access.conversationId },
        1,
        undefined,
        context,
      );
      requireClosed();
      throughEntryId = page.items[0]?.id ?? 0;
    }
    const conversation = String(access.conversationId);
    if (throughEntryId > 0 && access.responses.isImageEra(conversation, throughEntryId)) {
      // Too late to prove a fresh activation: never grandfather missing image-era metadata.
      throughEntryId = 0;
    }
    const candidate = {
      version: 1 as const,
      ownerId: access.ownerId,
      chatId: access.chatId,
      chatScope: access.chatScope,
      conversationId: conversation,
      throughEntryId,
    };
    requireClosed();
    return this.storage.transactionSync(() => {
      const winner = this.read();
      if (winner !== null) return this.check(access, winner).throughEntryId;
      const valid = Schema.decodeUnknownSync(Era)(candidate);
      this.storage.sql.exec(
        "INSERT INTO chat_image_legacy_era(singleton, metadata) VALUES(1, ?)",
        JSON.stringify(valid),
      );
      return valid.throughEntryId;
    });
  }
}
