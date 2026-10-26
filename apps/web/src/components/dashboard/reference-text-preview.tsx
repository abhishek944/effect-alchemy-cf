import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import { readAttachmentContent } from "@/lib/chat-preview-content";
import { useReferenceWorkspace } from "./reference-workspace";
import { useOriginalReferenceSource } from "./reference-original-source";
import { originalReferenceKey, type OriginalTextCapture } from "./reference-types";

const displayText = (text: string) => text.replace(/\r\n|\r/g, "\n");
const safeBoundary = (text: string, offset: number) =>
  !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text.charAt(offset - 1)) &&
    /[\uDC00-\uDFFF]/.test(text.charAt(offset))
  );
/** Textareas normalize line endings. Map native control offsets back to the exact decoded original. */
function originalOffset(text: string, displayOffset: number): number {
  let raw = 0;
  for (let shown = 0; shown < displayOffset && raw < text.length; shown++, raw++)
    if (text.charAt(raw) === "\r" && text.charAt(raw + 1) === "\n") raw++;
  return raw;
}

/** Raw decoded source, not CSV cells/excerpts. A native readonly control keeps keyboard selection. */
export function ReferenceTextPreview({
  file,
  active,
  onReveal,
}: {
  file: SavedFile;
  active: boolean;
  onReveal: () => void;
}) {
  const workspace = useReferenceWorkspace();
  const input = useRef<HTMLTextAreaElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [read, setRead] = useState<{
    file: SavedFile;
    attempt: number;
    text?: string;
    error?: string;
  } | null>(null);
  const current = read?.file === file && read.attempt === attempt ? read : null;
  const text = current?.text;
  const reveal = useRef(onReveal);
  useLayoutEffect(() => {
    reveal.current = onReveal;
  }, [onReveal]);
  useEffect(() => {
    if (!active || text !== undefined) return undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    void readAttachmentContent(file, signal)
      .then((content) => {
        if (signal.aborted) return undefined;
        if (content.originalText === undefined)
          throw new Error("The original has no decoded text.");
        setRead({ file, attempt, text: content.originalText });
        return undefined;
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setRead({
            file,
            attempt,
            error: error instanceof Error ? error.message : "Original text unavailable.",
          });
      });
    return () => controller.abort();
  }, [file, active, text, attempt]);
  useOriginalReferenceSource(file, async (capture) => {
    const node = input.current;
    if (!node || text === undefined || node.value !== displayText(text))
      throw new Error(
        "The exact original text is unavailable. Reopen it before viewing this selection.",
      );
    if (
      capture &&
      (capture.end > text.length || text.slice(capture.start, capture.end) !== capture.text)
    )
      throw new Error("The saved selection no longer matches this original.");
    reveal.current();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    if (!node.isConnected || node.getClientRects().length === 0)
      throw new Error("The text preview could not be shown. Open its tab to view this selection.");
    node.focus();
    if (!capture) return;
    const start = displayText(text.slice(0, capture.start)).length;
    const end = displayText(text.slice(0, capture.end)).length;
    node.setSelectionRange(start, end);
    const line = displayText(text.slice(0, capture.start)).split("\n").length - 1;
    const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
    node.scrollTop = Math.max(0, line * lineHeight - node.clientHeight / 3);
    if (node.selectionStart !== start || node.selectionEnd !== end)
      throw new Error("The exact original selection could not be revealed.");
  });
  const capture = () => {
    const node = input.current;
    if (!active || !node || text === undefined || node.value !== displayText(text)) return;
    const start = originalOffset(text, node.selectionStart);
    const end = originalOffset(text, node.selectionEnd);
    if (start >= end || end > text.length || !safeBoundary(text, start) || !safeBoundary(text, end))
      return;
    const firstLine = displayText(text.slice(0, start)).split("\n").length;
    const lastLine = displayText(text.slice(0, end)).split("\n").length;
    const value: OriginalTextCapture = Object.freeze({
      captureId: crypto.randomUUID(),
      start,
      end,
      text: text.slice(start, end),
      label: firstLine === lastLine ? `Line ${firstLine}` : `Lines ${firstLine}–${lastLine}`,
    });
    workspace.observe({
      kind: "original",
      chatId: file.chatId,
      sourceKey: originalReferenceKey(file.id),
      captureId: value.captureId,
      capture: value,
    });
  };
  if (current?.error)
    return (
      <div role="alert">
        {current.error}
        <button type="button" onClick={() => setAttempt((value) => value + 1)}>
          Retry text preview
        </button>
      </div>
    );
  if (text === undefined) return <output>Loading original text…</output>;
  return (
    <textarea
      ref={input}
      readOnly
      value={displayText(text)}
      data-cx="reference-original-text"
      aria-label={`${file.name} source text`}
      onPointerUp={capture}
      onKeyUp={(event) => {
        if (event.shiftKey || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a"))
          capture();
      }}
    />
  );
}
