import { useCallback, useLayoutEffect, useRef, useState, type SyntheticEvent } from "react";
import { ComposerPrimitive, useAui, useAuiState } from "@assistant-ui/react";
import { useChatStore } from "@/lib/chat-store-context";
import { useWorkspacePreview } from "./workspace-preview-context";
import { ChatReferenceChips } from "./chat-reference-chips";
import { ChatReferencePickerPopup } from "./chat-reference-picker";
import { useChatReferencesPicker } from "./use-chat-references-picker";
import { useChatReferenceFocus } from "./chat-reference-focus";
import type { ReferenceDraft } from "./chat-reference-draft";
import { useHistoryText } from "./chat-history-ui";

/** Actual assistant-ui input: typed caret spans and voice text retain their owning runtime. */
export function ChatReferenceInput({ chatId }: { chatId: string }) {
  const store = useChatStore();
  const { active } = useHistoryText();
  const aui = useAui();
  const text = useAuiState((state) => state.composer.text);
  const dictation = useAuiState((state) => state.composer.dictation);
  const preview = useWorkspacePreview();
  const focus = useChatReferenceFocus();
  const [anchor, setAnchor] = useState<HTMLTextAreaElement | null>(null);
  const [caret, setCaret] = useState<ReferenceDraft>({
    text,
    selectionStart: text.length,
    selectionEnd: text.length,
  });
  const [restoration, setRestoration] = useState<ReferenceDraft | null>(null);
  const applied = useRef<ReferenceDraft | null>(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const register = focus.register;
  const ref = useCallback(
    (node: HTMLTextAreaElement | null) => {
      setAnchor(node);
      register(node);
    },
    [register],
  );
  const draft =
    caret.text === text ? caret : { text, selectionStart: text.length, selectionEnd: text.length };
  const capture = (event: SyntheticEvent<HTMLTextAreaElement>) => {
    const node = event.currentTarget;
    setCaret({
      text: node.value,
      selectionStart: node.selectionStart,
      selectionEnd: node.selectionEnd,
    });
  };
  const picker = useChatReferencesPicker({
    chatId,
    draft,
    archived:
      !active ||
      Boolean(store.snapshot?.chat.archived) ||
      !focused ||
      composing ||
      Boolean(dictation) ||
      caret.text !== text,
    onSelect: store.references.add,
    onDraftChange: (next) => {
      aui.composer.setText(next.text);
      setCaret(next);
      setRestoration(next);
    },
  });
  useLayoutEffect(() => {
    if (!anchor || !restoration || applied.current === restoration || restoration.text !== text)
      return;
    applied.current = restoration;
    anchor.focus({ preventScroll: true });
    anchor.setSelectionRange(restoration.selectionStart, restoration.selectionEnd);
  }, [anchor, restoration, text]);
  const lockedIds =
    store.pendingSend?.chatId === chatId && store.pendingSend.phase !== "accepted"
      ? (store.pendingSend.frozen?.references ?? [])
      : [];
  return (
    <>
      <ChatReferenceChips
        references={store.references}
        active={active}
        archived={Boolean(store.snapshot?.chat.archived)}
        onOpenImage={preview.openImage}
        lockedIds={lockedIds}
        onRestoreDraftFocus={focus.focus}
      />
      <ComposerPrimitive.Input
        {...picker.inputProps}
        ref={ref}
        data-cx="chat-input"
        aria-label="Message your assistant"
        aria-describedby="chat-connection"
        placeholder="Message your assistant"
        rows={2}
        onChange={(event) => {
          setRestoration(null);
          capture(event);
        }}
        onSelect={capture}
        onFocus={(event) => {
          setFocused(true);
          capture(event);
        }}
        onBlur={(event) => {
          if (
            !(
              event.relatedTarget instanceof Element &&
              event.relatedTarget.closest('[data-cx="chat-reference-picker"]')
            )
          )
            setFocused(false);
        }}
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(event) => {
          setComposing(false);
          capture(event);
        }}
      />
      <ChatReferencePickerPopup picker={picker} anchor={anchor} />
      {store.references.blockedReason && (
        <output data-cx="setup-error">{store.references.blockedReason}</output>
      )}
    </>
  );
}
