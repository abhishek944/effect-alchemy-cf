import { useMemo, useRef, useState, type ComponentProps } from "react";
import {
  LexicalComposerContext,
  createLexicalComposerContext,
} from "@lexical/react/LexicalComposerContext";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import {
  createEditor,
  $createRangeSelectionFromDom,
  $setSelection,
  type LexicalEditor,
} from "lexical";
import { useReferenceWorkspace } from "./reference-workspace";
import { ReferenceNode } from "./reference-node";
import { ReferenceEditorPlugin } from "./reference-editor-plugin";
import type { ReferenceDraft } from "./chat-reference-draft";
import type { ReferenceSource } from "./reference-types";
import { readReferenceDrag, REFERENCE_DRAG_TYPE } from "./reference-drag";

export function ReferenceEditor({
  chatId,
  onDraft,
  onEditor,
  onError,
  onChooseSource,
  ...input
}: {
  chatId: string;
  onDraft: (draft: ReferenceDraft) => void;
  onEditor: (editor: LexicalEditor) => void;
  onError: (message: string) => void;
  onChooseSource: (source: ReferenceSource, anchor: HTMLElement) => void;
} & Pick<
  ComponentProps<typeof ContentEditable>,
  | "role"
  | "aria-autocomplete"
  | "aria-expanded"
  | "aria-controls"
  | "aria-activedescendant"
  | "onKeyDownCapture"
  | "onFocus"
  | "onBlur"
>) {
  const workspace = useReferenceWorkspace();
  const session = workspace.session(chatId);
  if (!session.editor)
    session.editor = createEditor({
      namespace: "starter-reference-composer",
      nodes: [ReferenceNode],
      onError: (error) => {
        throw error;
      },
    });
  const editor = session.editor;
  const context = useMemo<[LexicalEditor, ReturnType<typeof createLexicalComposerContext>]>(
    () => [editor, createLexicalComposerContext(null, {})],
    [editor],
  );
  const root = useRef<HTMLDivElement>(null);
  const [composing, setComposing] = useState(false);
  return (
    <LexicalComposerContext.Provider value={context}>
      <PlainTextPlugin
        contentEditable={
          <ContentEditable
            {...input}
            ref={root}
            data-cx="chat-input"
            data-composing={composing || undefined}
            aria-label="Message your assistant"
            aria-describedby="chat-connection"
            aria-multiline="true"
            onCompositionStart={() => setComposing(true)}
            onCompositionEnd={() => setComposing(false)}
            onDragOver={(event) => {
              if (event.dataTransfer.types.includes(REFERENCE_DRAG_TYPE)) {
                event.preventDefault();
                event.stopPropagation();
                event.dataTransfer.dropEffect = "copy";
              }
            }}
            onDrop={(event) => {
              if (!event.dataTransfer.types.includes(REFERENCE_DRAG_TYPE)) return;
              event.preventDefault();
              event.stopPropagation();
              const payload = readReferenceDrag(event.dataTransfer);
              const source =
                payload?.chatId === chatId ? workspace.source(chatId, payload.key) : null;
              if (!source) {
                onError("This tab is not an available reference source.");
                return;
              }
              // Browser hit-testing gives the actual drop caret, not the previous focused caret.
              const range = document.caretRangeFromPoint(event.clientX, event.clientY);
              if (!range || !root.current?.contains(range.startContainer)) {
                onError("Drop within the message text to choose a reference caret.");
                return;
              }
              const selection = window.getSelection();
              selection?.removeAllRanges();
              selection?.addRange(range);
              editor.update(
                () => {
                  const lexical = $createRangeSelectionFromDom(selection, editor);
                  if (lexical) $setSelection(lexical);
                },
                { discrete: true },
              );
              onChooseSource(source, event.currentTarget);
            }}
          />
        }
        placeholder={null}
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin externalHistoryState={session.history} />
      <ReferenceEditorPlugin chatId={chatId} onDraft={onDraft} onEditor={onEditor} />
    </LexicalComposerContext.Provider>
  );
}
