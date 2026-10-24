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
import type { Chat, ChatSnapshot, PanelRequest } from "./chat-model.ts";
import { INFERENCE_FAILURE } from "./chat-model.ts";
import type { Target } from "@starter/office-contract";
import type { SkillRecovery } from "./skills-model.ts";
import { buildWindow } from "./chat-projection.ts";
import { liveToolRound, partialToolPreview } from "./chat-tool-live.ts";
import { type ChatRuntime, PI_BACKGROUND } from "./chat-runtime.ts";
import { watchRetry, type RetryWatch } from "./chat-observation.ts";
import { sliceText, textInfo, textPage } from "./chat-text.ts";
export { RefreshFence, InvalidCursor } from "./chat-contract.ts";
export class ChatSource {
  private epoch = crypto.randomUUID();
  private readonly retry: RetryWatch = { key: null };
  private panelRequest: PanelRequest | null = null;
  requestPanel(target: Target): void {
    this.panelRequest = { id: crypto.randomUUID(), target, expiresAt: Date.now() + 30_000 };
    this.revision += 1;
    this.publish();
  }
  private stopNative: (() => void) | null = null;
  private revision = 0;
  private usageRevision = 0;
  private ready: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly runtime: ChatRuntime;
  private readonly recovery: () => SkillRecovery | null;
  private readonly hasGeneratedFiles: (entryId: number, modelIndex: number) => boolean;
  private readonly attemptState: (
    operationId: string,
  ) => { readonly logicalOperationId: string; readonly incomplete: boolean } | null;
  constructor(
    runtime: ChatRuntime,
    recovery: () => SkillRecovery | null = () => null,
    hasGeneratedFiles: (entryId: number, modelIndex: number) => boolean = () => false,
    attemptState: (
      operationId: string,
    ) => { readonly logicalOperationId: string; readonly incomplete: boolean } | null = () => null,
  ) {
    this.runtime = runtime;
    this.recovery = recovery;
    this.hasGeneratedFiles = hasGeneratedFiles;
    this.attemptState = attemptState;
  }
  async initialize(): Promise<void> {
    this.ready ??= this.runtime
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
    await this.ready;
  }
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
    if (this.stopNative === null) throw new RefreshFence();
    const revision = this.revision;
    const pi = await this.runtime.pi();
    const id = await this.runtime.conversationId();
    const native = await pi.snapshot(LiveDoc, id, PI_BACKGROUND);
    const active = native?.run?.inputs[0];
    const operation = active === undefined ? null : await this.runtime.operationIdOf(active);
    const toolsRound = await liveToolRound(pi, native, id, PI_BACKGROUND);
    if (revision !== this.revision) throw new RefreshFence();
    const generation = native?.generation;
    const messageId =
      generation === undefined
        ? null
        : `live:${this.epoch}:${native?.run?.taskId ?? "none"}:${generation.attempt}`;
    const textRevision = `l${this.epoch}:${revision}:${generation?.attempt ?? 0}`;
    return { revision, native, operation, messageId, textRevision, toolsRound };
  }
  async snapshot(chat: Chat): Promise<ChatSnapshot> {
    await this.runtime.ensureRoot(chat.id);
    await this.runtime.reconcile(chat.id);
    const live = await this.live();
    const partial = live.native?.generation?.message;
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
    const isRunning = live.native?.run !== undefined;
    const error = watchRetry(this.retry, chat.id, live, this.runtime.diagnostic)
      ? INFERENCE_FAILURE
      : isRunning
        ? null
        : await this.runtime.settlementError(chat.id);
    const recovery = this.recovery();
    const selection = await this.runtime.selection();
    const selectedModel = selection === null ? null : installedChatModel(selection.model);
    const base = {
      chat,
      messages,
      isRunning,
      activeOperationId: live.operation,
      error: !isRunning && recovery !== null ? recovery.message : error,
      model: selectedModel?.name ?? "Unknown",
      thinking: selection?.effort ?? "Unknown",
      usageRevision: `${this.epoch}:${this.usageRevision}`,
      skillRecovery: recovery,
      panelRequest: this.panelRequest,
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
      128 - (preview?.visited ?? 0) - toolBlocks,
      79,
      this.hasGeneratedFiles,
      this.attemptState,
      live.toolsRound,
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
    )
      throw new RefreshFence();
    const message = live.native.generation.message;
    const page = textPage(chat.id, messageId, live.textRevision, message, cursor);
    if (live.revision !== this.revision) throw new RefreshFence();
    if (page === null) throw new InvalidCursor();
    return page;
  }
}
