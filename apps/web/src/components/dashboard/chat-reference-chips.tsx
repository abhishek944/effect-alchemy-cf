import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import { ChatLibraryThumbnail } from "./chat-library-thumbnail";
import { savedIdentityLabel, savedOrigin, savedTime } from "./chat-library-format";
import type { ChatReferences } from "./use-chat-references";
import "./chat-reference-chips.css";

export function ChatReferenceChips({
  references,
  archived,
  onOpenImage,
  active = true,
  lockedIds = [],
  onRestoreDraftFocus,
}: {
  references: ChatReferences;
  archived: boolean;
  onOpenImage: (file: SavedFile) => void;
  active?: boolean;
  lockedIds?: readonly string[];
  onRestoreDraftFocus?: () => void;
}) {
  if (!references.files.length) return null;
  return (
    <div data-cx="chat-reference-chips" aria-label="Files referenced in this draft">
      {references.files.map((file) => {
        const read = references.readFor(file);
        const content = (
          <>
            <ChatLibraryThumbnail
              file={file}
              active={active}
              onState={(state) => {
                if (state === "error")
                  references.markUnavailable(file.id, "The saved original could not be read.");
              }}
            />
            <span data-cx="chat-reference-chip-label">
              <strong>{file.name}</strong>
              <small>
                {savedOrigin(file)} · {savedTime(file)}
              </small>
            </span>
          </>
        );
        return (
          <div
            key={file.id}
            data-cx="chat-reference-entry"
            data-read-error={read.state !== "ready"}
          >
            <div data-cx="chat-reference-chip">
              {file.kind === "image" ? (
                <button
                  type="button"
                  data-cx="chat-reference-body"
                  aria-label={`Open ${savedIdentityLabel(file)}`}
                  onClick={() => onOpenImage(file)}
                >
                  {content}
                </button>
              ) : read.state === "ready" ? (
                <a
                  data-cx="chat-reference-body"
                  href={savedOriginalUrl(file)}
                  download={file.name}
                  aria-label={`Download ${savedIdentityLabel(file)}`}
                >
                  {content}
                </a>
              ) : (
                <span data-cx="chat-reference-body" aria-label={savedIdentityLabel(file)}>
                  {content}
                </span>
              )}
              <button
                type="button"
                data-cx="chat-reference-remove"
                aria-label={`Remove ${savedIdentityLabel(file)} from draft`}
                disabled={archived || lockedIds.includes(file.id)}
                onClick={() => {
                  references.remove(file.id);
                  onRestoreDraftFocus?.();
                }}
              >
                ×
              </button>
            </div>
            {read.state !== "ready" && (
              <div
                data-cx="chat-reference-read-error"
                role={read.state === "reading" ? "status" : "alert"}
              >
                <strong>
                  {file.name} ·{" "}
                  {read.state === "reading" ? "Reading saved file…" : "Original unavailable"}
                </strong>
                <span>
                  {read.state === "reading"
                    ? "Reading the saved original only. No generation is started."
                    : "Your reference and draft are kept. Try reading the saved original again."}
                </span>
                {read.error && read.error !== "Original unavailable" && <span>{read.error}</span>}
                <button
                  type="button"
                  disabled={read.state === "reading" || !active}
                  onClick={() => void references.retry(file.id)}
                >
                  Retry reading file
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
