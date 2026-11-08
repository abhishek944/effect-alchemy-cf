import { useEffect, useId, useRef } from "react";
import type { LocalFile } from "@/lib/chat-file-local";
import { isLocalAttachment, type AttachmentSource } from "@/lib/chat-preview-content";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import { AttachmentContent } from "./attachment-content";
import { AttachmentFallback } from "./attachment-fallback";
import { ChatLibraryImage } from "./chat-library-image";
import { usePinnedImage } from "./chat-pinned-image";
import "./attachment-preview.css";

function LocalImage({ file, compact }: { file: LocalFile; compact: boolean }) {
  const { imgRef, state } = usePinnedImage(file.previewUrl);
  return (
    <span data-cx="attachment-local-image">
      {file.previewUrl ? <img ref={imgRef} alt={file.name} data-state={state} /> : null}
      {(!file.previewUrl || state !== "ready") && (
        <span>
          {compact ? (
            <AttachmentFallback />
          ) : state === "error" ? (
            "Image preview could not be loaded."
          ) : (
            "Preparing image…"
          )}
        </span>
      )}
    </span>
  );
}

export function AttachmentArt({
  source,
  active = true,
  compact = true,
}: {
  source: AttachmentSource;
  active?: boolean;
  compact?: boolean;
}) {
  if (source.kind === "image")
    return isLocalAttachment(source) ? (
      active ? (
        <LocalImage file={source} compact={compact} />
      ) : null
    ) : (
      <ChatLibraryImage file={source} active={active} thumbnail={compact} />
    );
  return <AttachmentContent source={source} active={active} compact={compact} />;
}

/** Native modal owns keyboard containment, Escape and restoration to the trigger. */
export function AttachmentPreview({
  source,
  onClose,
}: {
  source: AttachmentSource;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const node = dialog.current;
    const trigger = document.activeElement;
    node?.showModal();
    return () => {
      node?.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      data-cx="attachment-preview-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id={titleId}>{source.name}</h2>
        <button type="button" autoFocus onClick={onClose}>
          Close preview
        </button>
      </header>
      <div data-cx="attachment-preview-body">
        <AttachmentArt source={source} compact={false} />
      </div>
      <footer>
        {isLocalAttachment(source) ? (
          <span>Local preview · Not uploaded until Send</span>
        ) : (
          <a href={savedOriginalUrl(source)} download={source.name}>
            Download original
          </a>
        )}
      </footer>
    </dialog>
  );
}
