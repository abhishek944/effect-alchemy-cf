import { buildWindow } from "./chat-projection.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";
import { WINDOW_MESSAGES, RefreshFence, InvalidCursor } from "./chat-contract.ts";
import type { Chat, ChatSnapshot } from "./chat-model.ts";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { storedMessageTime } from "./chat-time.ts";
import { sliceText, textInfo, textPage } from "./chat-text.ts";
import { partialToolPreview } from "./chat-tool-live.ts";
import type { TextCursor } from "./chat-contract.ts";
export { RefreshFence, InvalidCursor } from "./chat-contract.ts";

/** A view subscription never owns a run or its cancellation signal. */
export class ChatSource {
  private readonly runtime: ChatRuntime;
  private readonly hasGeneratedFiles: (entry: number, index: number) => boolean;
  private readonly listeners = new Set<() => void>();
  private readonly epoch = crypto.randomUUID();
  private revision = 0;
  private usageRevision = 0;
  constructor(runtime: ChatRuntime, hasGeneratedFiles: (entry: number, index: number) => boolean) {
    this.runtime = runtime;
    this.hasGeneratedFiles = hasGeneratedFiles;
    runtime.subscribe(() => {
      this.revision += 1;
      this.publish();
    });
  }
  async initialize(): Promise<void> {}
  private publish(): void {
    for (const invalidate of this.listeners) {
      try {
        invalidate();
      } catch {
        continue;
      }
    }
  }
  invalidateUsage(): void {
    this.usageRevision += 1;
    this.publish();
  }
  subscribe(invalidate: () => void): () => void {
    this.listeners.add(invalidate);
    return () => {
      this.listeners.delete(invalidate);
    };
  }
  private live() {
    const active = this.runtime.active;
    const messageId =
      active?.partial === undefined ? null : `live:${this.epoch}:${active.record.runId}`;
    return {
      revision: this.revision,
      active,
      messageId,
      textRevision: `l${this.epoch}:${this.revision}`,
    };
  }
  async snapshot(chat: Chat): Promise<ChatSnapshot> {
    const live = this.live();
    const partial = live.active?.partial;
    const preview = partial === undefined ? null : sliceText(partial, 0, 0, 512, 32);
    const { visited: toolBlocks, ...tools } = partialToolPreview(partial);
    const messages =
      preview === null || live.messageId === null
        ? []
        : [
            {
              id: live.messageId,
              role: "assistant" as const,
              operationId: null,
              createdAt: storedMessageTime(partial?.timestamp),
              attachments: [],
              attemptOf: null,
              incomplete: false,
              usage: null,
              text: preview.text,
              ...tools,
              ...textInfo(chat.id, live.messageId, live.textRevision, preview),
            },
          ];
    const selection = await this.runtime.selection();
    const selected = selection === null ? null : installedChatModel(selection.model);
    const window = await buildWindow(
      await this.runtime.conversation(),
      chat,
      PI_BACKGROUND,
      null,
      WINDOW_MESSAGES,
      (entry) => this.runtime.publicInput(entry),
      128 - (preview?.visited ?? 0) - toolBlocks,
      79,
      this.hasGeneratedFiles,
      (operationId) => ({
        logicalOperationId: this.runtime.sends.logicalOperation(operationId) ?? operationId,
        incomplete: this.runtime.transcript.run(operationId)?.status === "unanswered",
      }),
      live.active?.assistantEntry === undefined
        ? undefined
        : {
            assistant: live.active.assistantEntry,
            slots: [...live.active.tools.values()],
          },
    );
    if (live.revision !== this.revision) throw new RefreshFence();
    return {
      chat,
      messages: [...window.messages, ...messages],
      history: window.history,
      isRunning: live.active !== null,
      activeOperationId: live.active?.record.operationId ?? null,
      error: live.active !== null ? null : await this.runtime.settlementError(chat.id),
      model: selected?.name ?? "Unknown",
      thinking: selection?.effort ?? "Unknown",
      usageRevision: `${this.epoch}:${this.usageRevision}`,
      skillRecovery: null,
    };
  }
  async text(chat: Chat, messageId: string, cursor: TextCursor | null) {
    const live = this.live();
    const partial = live.active?.partial;
    if (
      messageId !== live.messageId ||
      partial === undefined ||
      (cursor !== null && (cursor.message !== messageId || cursor.revision !== live.textRevision))
    )
      throw new RefreshFence();
    const page = textPage(chat.id, messageId, live.textRevision, partial, cursor);
    if (live.revision !== this.revision) throw new RefreshFence();
    if (page === null) throw new InvalidCursor();
    return page;
  }
}
