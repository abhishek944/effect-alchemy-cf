/**
 * The one admissible submission path for this composer.
 *
 * The form (ordinary Enter) and the custom Send button both call `submit`, so
 * keyboard and pointer cannot admit different drafts. The store stays
 * authoritative for operation identity, duplicates, staged files, busy/archive
 * and selection admission; this hook only decides what the user is told when a
 * draft is refused, and it clears the input only after a local dispatch.
 */
import { useState } from "react";
import { useAui, useAuiState } from "@assistant-ui/react";
import { useChatStore, type ChatSelectionControls } from "@/lib/chat-store-context";
import { useChatSkillsReadiness } from "./use-chat-skills-readiness";

const DICTATION_REASON = "Stop or cancel dictation before sending.";

/** The real reason the loaded model selection cannot be sent right now. */
export function chatReadinessReason(preferences: ChatSelectionControls): string | null {
  if (preferences.selectionReady) return null;
  if (preferences.error) return preferences.error;
  if (preferences.status === "idle") return "Choose a chat before choosing its model.";
  if (preferences.status === "loading")
    return "This chat's model settings are still loading. Try again when they are ready.";
  // A catalog that has not loaded yet is not evidence that the model is absent.
  if (!preferences.catalog)
    return "The model catalog is still loading. Try again when it is ready.";
  if (preferences.saving) return "Saving this chat's model settings…";
  const selection = preferences.selection;
  if (!selection) return "No model is selected for this chat yet. Choose a model before sending.";
  const entry = preferences.entry;
  if (!entry) return "The selected model is not in the current model catalog. Choose another.";
  if (entry.availability !== "enabled")
    return `${entry.name} is not enabled in this stage. Choose another model.`;
  if (!entry.efforts.includes(selection.effort))
    return `${entry.name} does not support the selected reasoning effort. Choose another effort.`;
  return "This chat's model selection is not ready yet. Try again in a moment.";
}

export function useChatSubmit({
  chatId,
  running,
  stopping,
}: {
  chatId: string;
  running: boolean;
  stopping: boolean;
}) {
  const store = useChatStore();
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const dictation = useAuiState((state) => state.composer.dictation);
  const connected = Boolean(store.snapshot) && store.connection === "live";
  const archived = Boolean(store.snapshot?.chat.archived);
  // Known-unavailable skills block Send; an unknown probe never does.
  const skills = useChatSkillsReadiness(chatId, connected && !archived);
  const busy = running || stopping || Boolean(store.pendingSend);
  const currentReadiness = () =>
    connected && !archived
      ? (chatReadinessReason(store.preferences) ?? skills.blockedReason)
      : null;
  const readiness = busy ? null : currentReadiness();
  const [attemptedReadiness, setAttemptedReadiness] = useState<string | null>(null);
  // Transient readiness never occupies or clears the persistent operation-error slot.
  const readinessFeedback =
    readiness === attemptedReadiness && readiness !== store.preferences.error ? readiness : null;
  const canSend =
    connected &&
    !archived &&
    !busy &&
    !dictation &&
    store.preferences.selectionReady &&
    (text.trim().length > 0 ||
      store.stagedFiles.files.length > 0 ||
      store.references.ids.length > 0) &&
    !store.stagedFiles.blockedReason &&
    !store.references.blockedReason &&
    skills.blockedReason === null;
  const blockedReason = dictation
    ? DICTATION_REASON
    : (readiness ?? store.references.blockedReason ?? store.stagedFiles.blockedReason);

  /** Shared by the form and the button; never clears the draft unless dispatched. */
  const submit = async (): Promise<void> => {
    const composer = aui.composer.getState();
    const draft = composer.text;
    if (!draft.trim() && store.stagedFiles.files.length === 0 && store.references.ids.length === 0)
      return;
    if (composer.dictation) {
      store.reportError(DICTATION_REASON);
      return;
    }
    // A send already in flight is named by the footer status; never duplicate it.
    if (running || stopping || store.pendingSend) return;
    // Name the same readiness block the disabled Send shows; the store stays
    // authoritative for every state that can actually be dispatched.
    const unready = currentReadiness();
    if (unready) {
      setAttemptedReadiness(unready);
      // A blocked send verifies recovery instead of assuming it.
      if (skills.status === "unavailable") void skills.recheck();
      return;
    }
    const outcome = await store.send(draft, chatId);
    if (outcome.status === "blocked") {
      store.reportError(outcome.message);
      return;
    }
    aui.composer.setText("");
  };

  return {
    submit,
    canSend,
    blockedReason,
    readinessFeedback,
    skillsNotice: skills.blockedReason,
    skillsChecking: skills.checking,
    recheckSkills: skills.recheck,
  };
}
