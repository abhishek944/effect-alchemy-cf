import { LiveDoc } from "@earendil-works/pi-durable";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { storedMessageTime } from "./chat-time.ts";
import {
  FRAME_BYTES,
  WINDOW_MESSAGES,
  InvalidCursor,
  RefreshFence,
  encodedBytes,
  type TextCursor,
} from "./chat-contract.ts";
import type { Chat, ChatSnapshot } from "./chat-model.ts";
import { INFERENCE_FAILURE } from "./chat-model.ts";
import { buildWindow } from "./chat-projection.ts";
import { type ChatRuntime, PI_BACKGROUND } from "./chat-runtime.ts";
import { sliceText, textInfo, textPage } from "./chat-text.ts";

export { RefreshFence, InvalidCursor } from "./chat-contract.ts";
/** One native subscription per DO lifetime; only a sequence and subscriber set are retained. */
export class ChatSource {
  private epoch = crypto.randomUUID();
  private stopNative: (() => void) | null = null;
  private revision = 0;
  private usageRevision = 0;
  private ready: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly runtime: ChatRuntime;
  constructor(runtime: ChatRuntime) {
    this.runtime = runtime;
  }
  async initialize(): Promise<void> {
    if (this.ready === null) {
      this.ready = this.runtime
        .pi()
        .then((pi) => {
          this.stopNative = pi.subscribeCommits(() => {
            this.revision += 1;
            this.publish();
          });
          return undefined;
        })
        .catch((error: unknown) => {
          this.ready = null;
          throw error;
        });
    }
    await this.ready;
  }
  private publish(): void {
    for (const invalidate of this.listeners) {
      try {
        invalidate();
      } catch {
        /* A viewer cannot break durable work. */
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
      if (this.listeners.size === 0) {
        this.stopNative?.();
        this.stopNative = null;
        this.ready = null;
        this.epoch = crypto.randomUUID();
        this.revision += 1;
      }
    };
  }
  private async live() {
    await this.initialize();
    // Last-stream detachment may occur while initialization's promise resumes.
    if (this.stopNative === null) throw new RefreshFence();
    const revision = this.revision;
    const pi = await this.runtime.pi();
    const id = await this.runtime.conversationId();
    const native = await pi.snapshot(LiveDoc, id, PI_BACKGROUND);
    const active = native?.run?.inputs[0];
    const operation = active === undefined ? null : await this.runtime.operationIdOf(active);
    if (revision !== this.revision) throw new RefreshFence();
    const generation = native?.generation;
    const messageId =
      generation === undefined
        ? null
        : `live:${this.epoch}:${native?.run?.taskId ?? "none"}:${generation.attempt}`;
    const textRevision = `l${this.epoch}:${revision}:${generation?.attempt ?? 0}`;
    return { revision, native, operation, messageId, textRevision };
  }
  async snapshot(chat: Chat): Promise<ChatSnapshot> {
    await this.runtime.ensureRoot();
    await this.runtime.reconcile();
    const live = await this.live();
    const partial = live.native?.generation?.message;
    const preview = partial === undefined ? null : sliceText(partial, 0, 0, 512, 32);
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
              usage: null,
              text: preview.text,
              ...textInfo(chat.id, live.messageId, live.textRevision, preview),
            },
          ];
    const isRunning = live.native?.run !== undefined;
    const error =
      live.native?.generation?.retry !== undefined
        ? INFERENCE_FAILURE
        : isRunning
          ? null
          : await this.runtime.settlementError();
    const selection = await this.runtime.selection();
    const selectedModel = selection === null ? null : installedChatModel(selection.model);
    const base = {
      chat,
      messages,
      isRunning,
      activeOperationId: live.operation,
      error,
      model: selectedModel?.name ?? "Unknown",
      thinking: selection?.effort ?? "Unknown",
      usageRevision: `${this.epoch}:${this.usageRevision}`,
      history: { ceilingEntryId: null, through: null, historyCursor: null },
    };
    const window = await buildWindow(
      await this.runtime.conversation(),
      chat,
      PI_BACKGROUND,
      null,
      WINDOW_MESSAGES,
      (entry) => this.runtime.publicInput(entry),
      FRAME_BYTES - encodedBytes(base) - 64,
      128 - (preview?.visited ?? 0),
      79,
    );
    if (live.revision !== this.revision) throw new RefreshFence();
    const result = {
      ...base,
      messages: [...window.messages, ...messages],
      history: window.history,
    };
    if (encodedBytes(result) + 32 > FRAME_BYTES) throw new Error("Snapshot byte budget exceeded");
    return result;
  }
  async text(chat: Chat, messageId: string, cursor: TextCursor | null) {
    const live = await this.live();
    if (
      messageId !== live.messageId ||
      live.native?.generation?.message === undefined ||
      (cursor !== null && (cursor.message !== messageId || cursor.revision !== live.textRevision))
    ) {
      throw new RefreshFence();
    }
    const page = textPage(
      chat.id,
      messageId,
      live.textRevision,
      live.native.generation.message,
      cursor,
    );
    if (live.revision !== this.revision) throw new RefreshFence();
    if (page === null) throw new InvalidCursor();
    return page;
  }
}
