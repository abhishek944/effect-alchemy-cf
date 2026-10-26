import { useEffect, useLayoutEffect, useRef } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { useAui, useAuiState } from "@assistant-ui/react";
import { MAX_OFFICE_SEND_ATTACHMENTS } from "@starter/office-contract";
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  CLEAR_HISTORY_COMMAND,
  COMMAND_PRIORITY_HIGH,
  HISTORY_PUSH_TAG,
  KEY_ENTER_COMMAND,
  PASTE_COMMAND,
  type LexicalEditor,
} from "lexical";
import { $createReferenceNode } from "./reference-node";
import {
  $projectRuntimeText,
  $readReferenceEditor,
  $selectReferenceOffsets,
} from "./reference-editor-state";
import { useReferenceWorkspace } from "./reference-workspace";
import type { ReferenceDraft } from "./chat-reference-draft";

export function ReferenceEditorPlugin({
  chatId,
  onDraft,
  onEditor,
}: {
  chatId: string;
  onDraft: (draft: ReferenceDraft) => void;
  onEditor: (editor: LexicalEditor) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const aui = useAui();
  const runtimeText = useAuiState((state) => state.composer.text);
  const disabled = useAuiState(
    (state) =>
      !state.composer.isEditing ||
      Boolean(state.composer.dictation?.inputDisabled) ||
      state.thread.isDisabled,
  );
  const workspace = useReferenceWorkspace();
  const { bindEditor } = workspace;
  const caret = workspace.session(chatId).caret;
  const callbacks = useRef({ onDraft, onEditor });
  useLayoutEffect(() => {
    callbacks.current = { onDraft, onEditor };
  }, [onDraft, onEditor]);
  const projected = useRef(false);
  useLayoutEffect(() => {
    editor.setEditable(!disabled);
  }, [editor, disabled]);
  useEffect(() => {
    let cancelled = false;
    // Conversation restores its assistant-ui draft in a parent effect on remount.
    queueMicrotask(() => {
      if (cancelled || editor.isComposing()) return;
      const latest = aui.composer.getState().text;
      const text = runtimeText === latest ? runtimeText : latest;
      const current = editor.getEditorState().read(() => $getRoot().getTextContent());
      if (current === text) return;
      projected.current = true;
      editor.update(() => $projectRuntimeText(text), { discrete: true, tag: "runtime-projection" });
      projected.current = false;
      if (!text) editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    });
    return () => {
      cancelled = true;
    };
  }, [editor, runtimeText, aui]);
  useEffect(() => {
    callbacks.current.onEditor(editor);
    return editor.registerUpdateListener(({ editorState, tags }) => {
      editorState.read(() => {
        const draft = $readReferenceEditor();
        if ($isRangeSelection($getSelection()))
          caret.current = { start: draft.selectionStart, end: draft.selectionEnd };
        if (
          !projected.current &&
          !tags.has("runtime-projection") &&
          aui.composer.getState().text !== draft.text
        )
          aui.composer.setText(draft.text);
        callbacks.current.onDraft(draft);
      });
    });
  }, [editor, aui, caret]);
  useEffect(
    () =>
      bindEditor(chatId, {
        read: () => editor.getEditorState().read($readReferenceEditor),
        remember(replace) {
          if (!editor.isEditable() || editor.isComposing())
            throw new Error("Finish composing before adding a reference.");
          const snapshot = editor.getEditorState().read($readReferenceEditor);
          const from = replace?.start ?? caret.current?.start ?? snapshot.selectionStart;
          const to = replace?.end ?? caret.current?.end ?? snapshot.selectionEnd;
          if (
            snapshot.inputs.filter((input) => input.start >= to || input.end <= from).length >=
            MAX_OFFICE_SEND_ATTACHMENTS
          )
            throw new Error("A message can contain at most eight inline references.");
          const identity = JSON.stringify(snapshot.inputs);
          return (value) => {
            const current = editor.getEditorState().read($readReferenceEditor);
            if (
              !editor.isEditable() ||
              editor.isComposing() ||
              current.text !== snapshot.text ||
              JSON.stringify(current.inputs) !== identity
            )
              throw new Error("The draft changed before the reference was ready. Add it again.");
            editor.update(
              () => {
                $selectReferenceOffsets(from, to);
                const range = $getSelection();
                if (!$isRangeSelection(range))
                  throw new Error("Select a text caret before adding a reference.");
                if (from > 0 && !/\s/u.test(snapshot.text.charAt(from - 1))) range.insertText(" ");
                range.insertNodes([$createReferenceNode(value)]);
                range.insertText(" ");
              },
              { discrete: true, tag: HISTORY_PUSH_TAG },
            );
            editor.focus();
          };
        },
      }),
    [bindEditor, chatId, editor, caret],
  );
  useEffect(() => {
    const enter = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        if (
          !event ||
          event.shiftKey ||
          event.isComposing ||
          event.keyCode === 229 ||
          editor.isComposing()
        )
          return false;
        event.preventDefault();
        editor.getRootElement()?.closest("form")?.requestSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    const paste = editor.registerCommand(
      PASTE_COMMAND,
      (event) => {
        if (!(event instanceof ClipboardEvent)) return false;
        const text = event.clipboardData?.getData("text/plain") ?? "";
        event.preventDefault();
        const selection = $getSelection();
        if ($isRangeSelection(selection) && text) selection.insertRawText(text);
        // File paste bubbles to the existing upload owner. No Lexical MIME/HTML identity import.
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    return () => {
      enter();
      paste();
    };
  }, [editor]);
  return null;
}
