import { useCallback, useState } from "react";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import { ChatLibraryImage, type LibraryImageState } from "./chat-library-image";
import { savedMeta, savedOrigin, savedTime } from "./chat-library-format";
import { useChatLibraryOriginal } from "./use-chat-library-original";
import { useChatLibrarySources } from "./use-chat-library-sources";
import { Icon } from "./icon";
import { AttachmentContent } from "./attachment-content";
import { ReferenceTextPreview } from "./reference-text-preview";
import "./chat-library-preview.css";
import "./chat-library-image.css";

export type ChatLibraryPreviewProps = {
  file: SavedFile;
  active: boolean;
  archived: boolean;
  onOpenSource: (fileId: string) => void;
  sourceNames?: Readonly<Record<string, string>>;
  textReferenceReveal?: (() => void) | undefined;
};

/** Saved original first, with private read-only text content or image viewing. */
export function ChatLibraryPreview({
  file,
  active,
  archived,
  onOpenSource,
  sourceNames,
  textReferenceReveal,
}: ChatLibraryPreviewProps) {
  const original = useChatLibraryOriginal(file, active);
  const saved = original.file;
  const loadedNames = useChatLibrarySources(saved.chatId, saved.sources, active && !sourceNames);
  const names = sourceNames ?? loadedNames;
  const [attempt, setAttempt] = useState(0);
  const [image, setImage] = useState<{
    file: SavedFile;
    attempt: number;
    state: LibraryImageState;
  } | null>(null);
  const onState = useCallback(
    (state: LibraryImageState) => setImage({ file: saved, attempt, state }),
    [saved, attempt],
  );
  const state = image?.file === saved && image.attempt === attempt ? image.state : "loading";
  const unavailable = saved.state !== "ready" || original.error !== null || state === "error";
  const canDownload =
    saved.state === "ready" &&
    !original.reading &&
    !original.error &&
    (saved.kind === "text" || saved.kind === "office" || state === "ready" || state === "withheld");
  const retry = () => {
    setAttempt((value) => value + 1);
    void original.retry();
  };

  return (
    <section
      data-cx="chat-library-preview"
      aria-label={`Saved original ${saved.name}`}
      hidden={!active}
    >
      <div data-cx="chat-library-stage">
        {original.reading ? (
          <div data-cx="chat-library-preview-status" aria-live="polite">
            <strong>Loading original…</strong>
            <p>Reading the saved file. No generation is started.</p>
          </div>
        ) : unavailable ? (
          <div data-cx="chat-library-preview-status" aria-live="polite">
            <strong>Original unavailable</strong>
            <p>
              {saved.name} is still saved in this chat.{" "}
              {original.error ?? "We could not read its original bytes."}
            </p>
            <button type="button" onClick={retry} disabled={!active}>
              Retry reading original
            </button>
            <small>This only reloads the saved file. It does not generate an image.</small>
          </div>
        ) : saved.kind === "image" ? (
          <>
            <ChatLibraryImage file={saved} active={active} attempt={attempt} onState={onState} />
            {state === "withheld" && (
              <button
                type="button"
                data-cx="chat-library-preview-retry"
                onClick={() => setAttempt((value) => value + 1)}
              >
                Retry preview
              </button>
            )}
          </>
        ) : saved.kind === "text" && textReferenceReveal ? (
          <ReferenceTextPreview file={saved} active={active} onReveal={textReferenceReveal} />
        ) : (
          <AttachmentContent source={saved} active={active} />
        )}
      </div>
      <div data-cx="chat-library-provenance">
        <div data-cx="chat-library-info-title">
          <strong>{saved.name}</strong>
          {canDownload ? (
            <a href={savedOriginalUrl(saved)} download={saved.name}>
              Download
            </a>
          ) : (
            <button type="button" disabled>
              Download
            </button>
          )}
        </div>
        <p>
          {savedOrigin(saved)} · {savedMeta(saved)}
        </p>
        <span>{savedTime(saved)} · Saved original</span>
        {saved.sources.length > 0 && (
          <div data-cx="chat-library-sources">
            <span>{saved.sources.length === 1 ? "Source:" : "Sources:"}</span>
            {saved.sources.map((id, index) => (
              <button
                key={`${index}/${id}`}
                type="button"
                aria-label={`Open source ${names[id] ?? index + 1}, file ${id}`}
                onClick={() => onOpenSource(id)}
              >
                {names[id] ?? `Saved source ${index + 1}`}
                <Icon name="arrow-right" />
              </button>
            ))}
          </div>
        )}
        {archived && <p>Archived chat · View and download only</p>}
      </div>
    </section>
  );
}
