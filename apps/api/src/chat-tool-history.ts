import {
  AssistantEntry,
  CompactionEntry,
  ResetEntry,
  ToolResultEntry,
  UserEntry,
  type Conversation,
  type EntryId,
  type EntryRecord,
  type ToolSlot,
} from "@earendil-works/pi-durable";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { MAX_ENTRY_FETCHES, MAX_BLOCK_VISITS, MAX_MODEL_CANDIDATES } from "./chat-contract.ts";
import { isEntryId } from "./chat-text.ts";
import {
  projectPublicTools,
  toolResultPreview,
  type ToolResultPreview,
} from "./chat-tool-projection.ts";

export type ProjectionBudget = { fetches: number; candidates: number; blocks: number };
export type LiveToolRound = { assistant: EntryId; slots: readonly ToolSlot[] };
const boundary = (entry: EntryRecord) =>
  AssistantEntry.is(entry) ||
  UserEntry.is(entry) ||
  ResetEntry.is(entry) ||
  CompactionEntry.is(entry);
/** Request-local round evidence; never a global cache keyed by reusable provider call IDs. */
export class ToolHistory {
  private readonly results = new Map<string, ToolResultPreview | null>();
  private truncated = false;
  private newestResult = 0;
  private needsRecovery: boolean;
  private readonly conversation: Conversation;
  private readonly context: Parameters<Conversation["entries"]>[3];
  private readonly budget: ProjectionBudget;
  private readonly blockLimit: number;
  private readonly candidateLimit: number;
  constructor(
    needsRecovery: boolean,
    conversation: Conversation,
    context: Parameters<Conversation["entries"]>[3],
    budget: ProjectionBudget,
    blockLimit = MAX_BLOCK_VISITS,
    candidateLimit = MAX_MODEL_CANDIDATES,
  ) {
    this.needsRecovery = needsRecovery;
    this.conversation = conversation;
    this.context = context;
    this.budget = budget;
    this.blockLimit = blockLimit;
    this.candidateLimit = candidateLimit;
  }
  observe(entry: EntryRecord, message: Message): void {
    if (!ToolResultEntry.is(entry) || message.role !== "toolResult") return;
    this.newestResult = Math.max(this.newestResult, entry.id);
    if (this.results.size >= 128) {
      this.truncated = true;
      return;
    }
    const preview = toolResultPreview(
      entry,
      message,
      Math.max(0, this.blockLimit - this.budget.blocks),
    );
    this.budget.blocks += preview.visited;
    const duplicate = this.results.has(message.toolCallId);
    this.results.set(message.toolCallId, duplicate ? null : preview.result);
    this.truncated ||= duplicate;
  }
  finish(entry: EntryRecord): void {
    if (!boundary(entry)) return;
    this.results.clear();
    this.newestResult = 0;
    this.truncated = false;
    this.needsRecovery = false;
  }
  private async recover(assistant: EntryId, ceiling: number): Promise<void> {
    // A cursor can start below some results. Scan only this first round forward,
    // through the captured ceiling, stopping at the next native round/input boundary.
    // Keep already collected results and seek only the newer, omitted suffix.
    let next = Math.max(assistant + 1, this.newestResult + 1);
    while (next <= ceiling) {
      if (
        this.budget.fetches >= MAX_ENTRY_FETCHES ||
        this.budget.candidates >= this.candidateLimit ||
        this.budget.blocks >= this.blockLimit ||
        !isEntryId(next) ||
        !isEntryId(ceiling)
      ) {
        this.truncated = true;
        return;
      }
      const page = await this.conversation.entries(
        { order: "ascending", minEntryId: next, maxEntryId: ceiling },
        1,
        undefined,
        this.context,
      );
      this.budget.fetches += 1;
      const entry = page.items[0];
      if (entry === undefined || boundary(entry)) return;
      for (const message of entry.model ?? []) {
        if (
          this.budget.candidates >= this.candidateLimit ||
          this.budget.blocks >= this.blockLimit
        ) {
          this.truncated = true;
          return;
        }
        this.budget.candidates += 1;
        this.observe(entry, message);
      }
      next = entry.id + 1;
      if (page.next === undefined) return;
    }
  }
  async project(
    entry: EntryRecord,
    message: AssistantMessage,
    ceiling: number,
    byteBudget: number,
    live?: LiveToolRound,
  ) {
    if (this.needsRecovery) {
      await this.recover(entry.id, ceiling);
      this.needsRecovery = false;
    }
    const preview = projectPublicTools(
      message,
      this.results,
      Math.max(0, this.blockLimit - this.budget.blocks),
      byteBudget,
      live?.assistant === entry.id ? live.slots : [],
      this.truncated,
    );
    this.budget.blocks += preview.visited;
    return { tools: preview.tools, toolsTruncated: preview.toolsTruncated };
  }
}
