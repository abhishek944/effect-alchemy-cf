import { useId, useState, type KeyboardEvent } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import { consumeReferenceToken, referenceToken, type ReferenceDraft } from "./chat-reference-draft";
import { useChatReferencesLookup } from "./use-chat-references-lookup";

export type ChatReferencePickerOptions = {
  chatId: string;
  draft: ReferenceDraft;
  /** Parent applies text+selection together, then restores native input focus/caret. */
  onDraftChange: (draft: ReferenceDraft) => void;
  /** Synchronous controlled reference admission; false preserves the @ token. */
  onSelect: (file: SavedFile) => boolean;
  archived: boolean;
};

export function useChatReferencesPicker(options: ChatReferencePickerOptions) {
  const { chatId, draft, archived, onSelect, onDraftChange } = options;
  const token = referenceToken(draft);
  const tokenKey = JSON.stringify([chatId, draft.text, draft.selectionStart, draft.selectionEnd]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const open = token !== null && !archived && dismissed !== tokenKey;
  const lookup = useChatReferencesLookup(chatId, open ? token.query : null);
  const [selected, setSelected] = useState<{ key: string; index: number } | null>(null);
  const index = Math.min(
    selected?.key === lookup.key ? selected.index : 0,
    Math.max(0, lookup.files.length - 1),
  );
  const listId = useId();
  const optionId = (fileId: string) => `${listId}-${fileId}`;
  const activeFile = lookup.files[index];
  const dismiss = () => setDismissed(tokenKey);
  const choose = (file: SavedFile) => {
    if (
      !open ||
      !token ||
      lookup.state !== "ready" ||
      file.chatId !== chatId ||
      file.state !== "ready"
    )
      return;
    if (!lookup.files.some((item) => item.id === file.id) || !onSelect(file)) return;
    onDraftChange(consumeReferenceToken(draft, token));
    dismiss();
  };
  const onKeyDownCapture = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open || event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "Enter" && event.shiftKey) return;
    if (!["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === "Escape") {
      dismiss();
      return;
    }
    if (event.key === "Enter") {
      if (activeFile) choose(activeFile);
      return;
    }
    if (!lookup.files.length) return;
    const step = event.key === "ArrowDown" ? 1 : -1;
    setSelected({
      key: lookup.key,
      index: (index + step + lookup.files.length) % lookup.files.length,
    });
  };
  return {
    ...lookup,
    open,
    listId,
    optionId,
    activeId: activeFile?.id ?? null,
    activate: (id: string) => {
      const next = lookup.files.findIndex((file) => file.id === id);
      if (next >= 0) setSelected({ key: lookup.key, index: next });
    },
    choose,
    dismiss,
    inputProps: {
      role: "combobox" as const,
      "aria-autocomplete": "list" as const,
      "aria-expanded": open,
      "aria-controls": open ? listId : undefined,
      "aria-activedescendant": open && activeFile ? optionId(activeFile.id) : undefined,
      onKeyDownCapture,
    },
  };
}

export type ChatReferencePicker = ReturnType<typeof useChatReferencesPicker>;
