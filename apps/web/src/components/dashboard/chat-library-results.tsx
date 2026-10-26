import { useCallback, useState } from "react";
import { formatFileSize } from "@/lib/chat-file-local";
import type { SavedFile } from "@/lib/chat-library-types";
import { isNativeOpenFile } from "@/lib/office-original";
import { ChatLibraryImage, type LibraryImageState } from "./chat-library-image";
import { AttachmentArt, AttachmentPreview } from "./attachment-preview";
import { ChatLibraryResultActions, type LibraryResultActions } from "./chat-library-result-actions";
import { savedIdentityLabel, savedOrigin } from "./chat-library-format";
import { useChatLibraryOriginal } from "./use-chat-library-original";
import { useMessageImageAlts } from "./chat-message-image-alts";
import "./chat-library-results.css";
import "./chat-library-image.css";

function Result({
  file,
  archived,
  active,
  actions,
  sent,
}: {
  file: SavedFile;
  sent: boolean;
  archived: boolean;
  active: boolean;
  actions: LibraryResultActions;
}) {
  const [preview, setPreview] = useState(false);
  if (!active && preview) setPreview(false);
  const original = useChatLibraryOriginal(file, active);
  const saved = original.file;
  const [image, setImage] = useState<{ file: SavedFile; state: LibraryImageState } | null>(null);
  const onUnavailable = actions.onUnavailable;
  const onState = useCallback(
    (state: LibraryImageState) => {
      setImage({ file: saved, state });
      if (state === "error") onUnavailable?.(saved.id, "The saved original could not be read.");
    },
    [saved, onUnavailable],
  );
  const readable =
    saved.state === "ready" &&
    !original.error &&
    !original.reading &&
    !(image?.file === saved && image.state === "error");
  const alts = useMessageImageAlts();
  const caption = alts.find((entry) => entry.src.includes(saved.id))?.alt.trim() || null;
  const copy = (
    <span data-cx="chat-library-result-copy">
      <strong title={saved.name}>
        {saved.name}
        {caption ? ` — ${caption}` : null}
      </strong>
      <small>
        {sent ? (
          <>
            {saved.kind === "image" ? "Attached image" : "Attached file"} ·{" "}
            {formatFileSize(saved.byteSize)}
          </>
        ) : (
          <>
            {savedOrigin(saved)} ·{" "}
            {saved.width && saved.height
              ? `${saved.width} × ${saved.height}`
              : saved.kind === "office"
                ? "Office original"
                : "Safe text"}{" "}
            · Saved
          </>
        )}
      </small>
    </span>
  );
  const art =
    saved.kind === "image" && saved.state === "ready" ? (
      <ChatLibraryImage file={saved} thumbnail active={active} onState={onState} />
    ) : saved.state === "ready" ? (
      <AttachmentArt source={saved} active={active} />
    ) : (
      <span data-cx="chat-library-result-kind">Original unavailable</span>
    );
  return (
    <div data-cx="chat-library-result">
      {saved.kind === "image" ? (
        <button
          type="button"
          data-cx="chat-library-result-card"
          aria-label={`Open ${savedIdentityLabel(saved)}`}
          onClick={() => actions.onOpenImage(saved)}
        >
          {art}
          {copy}
        </button>
      ) : readable ? (
        <button
          type="button"
          data-cx="chat-library-result-card"
          aria-label={`Preview ${savedIdentityLabel(saved)}`}
          onClick={() => setPreview(true)}
        >
          {art}
          {copy}
        </button>
      ) : (
        <div data-cx="chat-library-result-card">
          {art}
          {copy}
        </div>
      )}
      {preview && active && (
        <AttachmentPreview
          source={saved}
          onClose={() => setPreview(false)}
          onOpenOffice={
            isNativeOpenFile(saved)
              ? () => {
                  setPreview(false);
                  actions.onOpenImage(saved);
                }
              : undefined
          }
        />
      )}
      <ChatLibraryResultActions
        file={saved}
        archived={archived}
        readable={readable}
        actions={actions}
      />
      {!readable && (
        <div data-cx="chat-library-result-read" aria-live="polite">
          <span>
            {original.reading ? "Reading saved file…" : `${saved.name} · Original unavailable`}
          </span>
          {original.error && <span>{original.error}</span>}
          <button
            type="button"
            disabled={!active || original.reading}
            onClick={() => void original.retry()}
          >
            Retry reading file
          </button>
        </div>
      )}
    </div>
  );
}

/** Per-file actions only. Parent keeps existing timestamp/audio/copy/facts once per message. */
export function ChatLibraryResults({
  files,
  archived,
  active = true,
  presentation,
  ...actions
}: LibraryResultActions & {
  files: readonly SavedFile[];
  archived: boolean;
  active?: boolean;
  presentation?: "sent";
}) {
  return (
    <div data-cx="chat-library-results">
      {files.map((file) => (
        <Result
          key={file.id}
          file={file}
          archived={archived}
          active={active}
          actions={actions}
          sent={presentation === "sent"}
        />
      ))}
    </div>
  );
}
