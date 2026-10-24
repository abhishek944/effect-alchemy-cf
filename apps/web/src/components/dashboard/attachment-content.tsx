import { useEffect, useRef, useState } from "react";
import {
  readAttachmentContent,
  type AttachmentContent as Content,
  type AttachmentSource,
} from "@/lib/chat-preview-content";
import { AttachmentFallback } from "./attachment-fallback";
import "./attachment-preview.css";

/** Visible-only private reads. Unmount, hidden panes and retries cancel old work. */
export function AttachmentContent({
  source,
  active = true,
  compact = false,
}: {
  source: AttachmentSource;
  active?: boolean;
  compact?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(!compact);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{
    source: AttachmentSource;
    attempt: number;
    content?: Content;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!compact || !container.current) return undefined;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(container.current);
    return () => observer.disconnect();
  }, [compact]);
  useEffect(() => {
    if (!active || !visible) return undefined;
    const controller = new AbortController();
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)]);
    void readAttachmentContent(source, signal).then(
      (content) => {
        if (!signal.aborted) setResult({ source, attempt, content });
        return undefined;
      },
      (error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            source,
            attempt,
            error: signal.aborted
              ? "Preview timed out. Try again or download the original."
              : error instanceof Error
                ? error.message
                : "Preview unavailable.",
          });
      },
    );
    return () => controller.abort();
  }, [source, active, visible, attempt]);
  const current = result?.source === source && result.attempt === attempt ? result : null;
  const readableSections = current?.content?.sections.filter((section) =>
    section.rows
      ? section.rows.some((row) => row.some((cell) => cell.trim()))
      : section.text?.trim(),
  );
  const sections = compact ? readableSections?.slice(0, 1) : current?.content?.sections;
  return (
    <div ref={container} data-cx="attachment-content" data-compact={compact}>
      {compact && (!current || current.error || !sections?.length) ? (
        <AttachmentFallback />
      ) : !current ? (
        <span>Loading preview…</span>
      ) : current.error ? (
        <div>
          <span>{current.error}</span>
          {!compact && (
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              Retry preview
            </button>
          )}
        </div>
      ) : (
        <>
          {!sections?.length && (
            <span>{current.content?.note ?? "No readable content was found in this file."}</span>
          )}
          {!compact && Boolean(sections?.length) && current.content?.note && (
            <p data-cx="attachment-preview-note">{current.content.note}</p>
          )}
          {sections?.map((section, index) => (
            <section key={index}>
              {!compact && <h3>{section.title}</h3>}
              {section.rows ? (
                section.rows.length ? (
                  <table aria-label={`${source.name} content preview`}>
                    <tbody>
                      {(compact ? section.rows.slice(0, 5) : section.rows).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {(compact ? row.slice(0, 4) : row).map((cell, column) => (
                            <td key={column}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <span>This file has no rows.</span>
                )
              ) : (
                <pre>
                  {section.text?.trim()
                    ? compact
                      ? section.text.slice(0, 1000)
                      : section.text
                    : "This file has no readable text."}
                </pre>
              )}
            </section>
          ))}
        </>
      )}
    </div>
  );
}
