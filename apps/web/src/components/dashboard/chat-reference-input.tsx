import { useCallback, useState } from "react";
import { useAuiState } from "@assistant-ui/react";
import type { LexicalEditor } from "lexical";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspacePreview } from "./workspace-preview-context";
import { useChatReferenceFocus } from "./chat-reference-focus";
import { useHistoryText } from "./chat-history-ui";
import type { ReferenceDraft } from "./chat-reference-draft";
import type { ReferenceSource } from "./reference-types";
import { ReferenceEditor } from "./reference-editor";
import { useReferencePicker } from "./reference-picker";
import { ReferencePickerPopup } from "./reference-picker-popup";
import { ReferenceSelectionMenu } from "./reference-selection-menu";
import { useReferenceWorkspace } from "./reference-workspace";

/** Lexical owns the atomic view/history; assistant-ui remains the only text/voice runtime. */
export function ChatReferenceInput({ chatId }: { chatId: string }) {
  const store = useChatStore();
  const { active } = useHistoryText();
  const text = useAuiState((state) => state.composer.text);
  const dictation = useAuiState((state) => state.composer.dictation);
  const preview = useWorkspacePreview();
  const workspace = useReferenceWorkspace();
  const focus = useChatReferenceFocus();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState<ReferenceDraft>({
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  const [scope, setScope] = useState<{ source: ReferenceSource; anchor: HTMLElement } | null>(null);
  // Late reference failures stay with this composer's chat, even if another chat becomes visible.
  const report = (error: unknown) =>
    store.reportChatError(
      chatId,
      error instanceof Error ? error.message : "Reference unavailable.",
    );
  const reportMessage = (message: string) => store.reportChatError(chatId, message);
  const picker = useReferencePicker({
    chatId,
    draft,
    enabled:
      active &&
      focused &&
      !dictation &&
      draft.text === text &&
      !store.snapshot?.chat.archived &&
      !anchor?.dataset.composing,
    revealOriginal: preview.openImage,
    report: reportMessage,
  });
  const register = focus.register;
  const onEditor = useCallback(
    (editor: LexicalEditor) => {
      setAnchor(editor.getRootElement());
      register(() => editor.focus());
    },
    [register],
  );
  const observation = scope
    ? workspace.observations(chatId).find((item) => item.sourceKey === scope.source.key)
    : null;
  return (
    <>
      <ReferenceEditor
        key={chatId}
        chatId={chatId}
        {...picker.inputProps}
        onDraft={setDraft}
        onEditor={onEditor}
        onError={reportMessage}
        onChooseSource={(source, element) => setScope({ source, anchor: element })}
        onFocus={() => setFocused(true)}
        onBlur={(event) => {
          if (
            !(
              event.relatedTarget instanceof Element &&
              event.relatedTarget.closest(
                '[data-cx="chat-reference-picker"],[data-cx="reference-selection-menu"]',
              )
            )
          )
            setFocused(false);
        }}
      />
      <ReferencePickerPopup picker={picker} anchor={anchor} />
      {scope && (
        <ReferenceSelectionMenu
          anchor={scope.anchor}
          label="Reference whole source"
          onClose={() => setScope(null)}
          onChoose={() => {
            const source = scope.source;
            setScope(null);
            void workspace.add(source).catch(report);
          }}
        >
          {observation && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const source = scope.source;
                setScope(null);
                void workspace.add(source, observation).catch(report);
              }}
            >
              Reference selected scope
            </button>
          )}
        </ReferenceSelectionMenu>
      )}
    </>
  );
}
