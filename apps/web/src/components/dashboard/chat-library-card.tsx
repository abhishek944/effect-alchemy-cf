import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import { ChatLibraryImage } from "./chat-library-image";
import { savedIdentityLabel, savedMeta, savedOrigin, savedTime } from "./chat-library-format";
import { useChatLibraryOriginal } from "./use-chat-library-original";

export function ChatLibraryCard({
  file,
  active,
  onOpenImage,
}: {
  file: SavedFile;
  active: boolean;
  onOpenImage: (fileId: string) => void;
}) {
  const original = useChatLibraryOriginal(file, active);
  const saved = original.file;
  const content = (
    <>
      {saved.kind === "image" && saved.state === "ready" ? (
        <ChatLibraryImage file={saved} thumbnail active={active} />
      ) : (
        <span data-cx="chat-library-kind" aria-hidden="true">
          {saved.kind === "image" ? "Image" : saved.kind === "office" ? "Office" : "Aa"}
        </span>
      )}
      <strong>{saved.name}</strong>
      <small>
        {savedOrigin(saved)} · {savedTime(saved)}
      </small>
      <small>{savedMeta(saved)}</small>
      {saved.state !== "ready" && <small>Original unavailable</small>}
      {(saved.kind === "text" || saved.kind === "office") && saved.state === "ready" && (
        <span data-cx="chat-library-download-label">Download file</span>
      )}
    </>
  );
  if (saved.kind === "image")
    return (
      <button
        type="button"
        data-cx="chat-library-card"
        aria-label={`Open ${savedIdentityLabel(saved)}`}
        onClick={() => onOpenImage(saved.id)}
      >
        {content}
      </button>
    );
  if (saved.state === "ready")
    return (
      <a
        data-cx="chat-library-card"
        aria-label={`Download ${savedIdentityLabel(saved)}`}
        href={savedOriginalUrl(saved)}
        download={saved.name}
      >
        {content}
      </a>
    );
  return (
    <div data-cx="chat-library-card" aria-label={savedIdentityLabel(saved)}>
      {content}
      {original.error && <small role="alert">{original.error}</small>}
      <button
        type="button"
        data-cx="chat-library-read-retry"
        disabled={original.reading || !active}
        onClick={() => void original.retry()}
      >
        {original.reading ? "Reading saved file…" : "Retry reading file"}
      </button>
    </div>
  );
}
