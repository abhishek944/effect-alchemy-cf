/** Runs one preference save with strict server confirmation. */
import type { Dispatch, SetStateAction } from "react";
import { capabilityMessage, writeChatPreferences } from "@/lib/chat-capability-api";
import { ChatApiError } from "@/lib/chat-api";
import type { ChatSelection } from "@/lib/chat-capability-types";
import { effortLabel } from "@/lib/chat-selection-labels";
import type { SetupRecord, WriteRecord } from "./chat-preference-records";

export type PreferenceWriteInput = {
  chatId: string;
  key: string;
  previous: SetupRecord;
  requested: ChatSelection;
  /** Explanation to show only after the server confirms this exact selection. */
  successNotice: string | null;
  mounted: () => boolean;
  setSetup: Dispatch<SetStateAction<SetupRecord | null>>;
  patchWrite: (key: string, next: Partial<WriteRecord>) => void;
  setAccountDefault: (selection: ChatSelection) => void;
};

/**
 * A server that returns a different selection than requested is treated as an
 * error that requires a refresh, never as a silent "using applied" adjustment.
 * Every state touch is scoped to the write's key, so a stale chat cannot leak.
 */
export async function runPreferenceWrite(input: PreferenceWriteInput): Promise<void> {
  const { chatId, key, previous, requested, successNotice } = input;
  try {
    const result = await writeChatPreferences(chatId, previous.revision, requested);
    const applied = result.view.preferences.preferred;
    if (applied.model !== requested.model || applied.effort !== requested.effort) {
      input.setSetup((current) => (current?.key === key ? previous : current));
      input.patchWrite(key, {
        saving: false,
        notice: null,
        error: `The server returned a different selection (${effortLabel(
          applied.effort,
        )}). Reload to see the current choice.`,
      });
      return;
    }
    input.setSetup((current) =>
      current?.key === key
        ? {
            key,
            selection: applied,
            efforts: result.view.preferences.modelEfforts,
            revision: result.view.preferences.revision,
            error: null,
          }
        : current,
    );
    // Account defaults are global and only ever applied when the server confirmed them.
    if (result.accountDefaultUpdated && input.mounted()) input.setAccountDefault(applied);
    input.patchWrite(key, { saving: false, error: null, notice: successNotice });
  } catch (cause) {
    input.setSetup((current) => (current?.key === key ? previous : current));
    input.patchWrite(key, {
      saving: false,
      notice: null,
      error:
        cause instanceof ChatApiError && cause.status === 409
          ? "Model settings changed elsewhere. Reload to see the current choice."
          : capabilityMessage(cause, "Saving the model setting"),
    });
  }
}
