/** Keyed records shared by the preference hook and its write runner. */
import type { CapabilityLoadState } from "@/lib/chat-capability-api";
import type { ChatModelEffort, ChatSelection } from "@/lib/chat-capability-types";

export type SetupRecord = {
  key: string;
  selection: ChatSelection | null;
  efforts: readonly ChatModelEffort[];
  revision: number;
  error: string | null;
};

export type WriteRecord = {
  key: string;
  saving: boolean;
  error: string | null;
  notice: string | null;
};

export type StagedRecord = { key: string; selection: ChatSelection; needsChoice: boolean };

export const loadStatus = (
  chatId: string | null,
  loaded: SetupRecord | null,
): CapabilityLoadState =>
  !chatId ? "idle" : !loaded ? "loading" : loaded.error ? "error" : "ready";
