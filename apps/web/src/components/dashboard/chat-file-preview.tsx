import { useEffect, useLayoutEffect, useRef } from "react";
import { ImagePanel, OfficePanel, previewMeta, TextPanel } from "./chat-file-panels";
import type { PreviewFile, PreviewLease } from "./chat-file-preview-types";
import "./chat-file-preview.css";

export type { PreviewFile } from "./chat-file-preview-types";

/** One bounded tabbed inspector for images and escaped text; never markup. */
export default function ChatFilePreview({
  files,
  index,
  allowed,
  withheldReason = null,
  lease = null,
  onIndexChange,
  onClose,
}: {
  files: PreviewFile[];
  index: number;
  /** False when the shared tab budget withheld this content's load. */
  allowed: boolean;
  /** Honest reason shown while withheld. */
  withheldReason?: string | null;
  /** Actual lease the opened content pins while its native work runs. */
  lease?: PreviewLease | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const active = files[Math.min(Math.max(index, 0), files.length - 1)];

  // Native modal lifecycle (admin-mobile-nav precedent): real containment and
  // background exclusion, replay-safe under StrictMode, focus returned on exit.
  // Top-layer coordinates are viewport-based, so the dialog is centered on the
  // actual chat pane rect and stays within its 8px inset.
  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const previous = document.activeElement;
    if (!dialog.open) dialog.showModal();
    const position = () => {
      const pane = dialog.closest('[data-cx="chat-page"]') ?? document.documentElement;
      const paneRect = pane.getBoundingClientRect();
      if (paneRect.width < 64 || paneRect.height < 64) return;
      const width = Math.min(400, Math.max(160, paneRect.width - 16));
      const maxHeight = Math.min(640, Math.max(160, paneRect.height - 16));
      dialog.style.width = `${width}px`;
      dialog.style.maxHeight = `${maxHeight}px`;
      const height = Math.min(dialog.offsetHeight, maxHeight);
      const left = paneRect.left + Math.max(0, (paneRect.width - width) / 2);
      const centered = paneRect.top + Math.max(0, (paneRect.height - height) / 2);
      const top = Math.min(
        Math.max(paneRect.top + 8, centered),
        Math.max(paneRect.top + 8, paneRect.bottom - 8 - height),
      );
      dialog.style.left = `${left}px`;
      dialog.style.top = `${top}px`;
    };
    position();
    dialog.focus();
    const pane = dialog.closest('[data-cx="chat-page"]');
    const observer = new ResizeObserver(position);
    if (pane) observer.observe(pane);
    observer.observe(dialog);
    window.addEventListener("resize", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      if (dialog.open) dialog.close();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Consume in capture so the installed thread speech-cancel never sees it.
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [onClose]);

  if (!active) return null;
  const move = (step: number) => onIndexChange((index + step + files.length) % files.length);

  return (
    <dialog
      ref={dialogRef}
      tabIndex={-1}
      data-cx="preview-dialog"
      aria-label={`Preview ${active.name}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header data-cx="preview-head">
        <div data-cx="preview-tabs" role="tablist" aria-label="Staged files">
          {files.map((file, position) => (
            <button
              key={file.id}
              type="button"
              role="tab"
              data-cx="preview-tab"
              aria-selected={position === index}
              onClick={() => onIndexChange(position)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  move(1);
                }
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  move(-1);
                }
                if (event.key === "Home") {
                  event.preventDefault();
                  onIndexChange(0);
                }
                if (event.key === "End") {
                  event.preventDefault();
                  onIndexChange(files.length - 1);
                }
              }}
            >
              {file.name}
            </button>
          ))}
        </div>
        <button type="button" data-cx="preview-close" aria-label="Close preview" onClick={onClose}>
          ✕
        </button>
      </header>
      <p data-cx="preview-meta">{previewMeta(active)}</p>
      <section
        data-cx="preview-panel"
        aria-label={`${
          active.kind === "image" ? "Image" : active.kind === "office" ? "Office" : "Text"
        } content for ${active.name}`}
      >
        {active.kind === "image" ? (
          <ImagePanel
            file={active}
            lease={lease}
            allowed={allowed}
            withheldReason={withheldReason}
          />
        ) : active.kind === "office" ? (
          <OfficePanel file={active} />
        ) : (
          <TextPanel
            file={active}
            lease={lease}
            allowed={allowed}
            withheldReason={withheldReason}
          />
        )}
      </section>
    </dialog>
  );
}
