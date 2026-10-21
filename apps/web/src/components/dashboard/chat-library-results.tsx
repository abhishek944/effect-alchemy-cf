import { useCallback, useState } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import { ChatLibraryImage, type LibraryImageState } from "./chat-library-image";
import { ChatLibraryResultActions, type LibraryResultActions } from "./chat-library-result-actions";
import { savedIdentityLabel, savedOrigin } from "./chat-library-format";
import { useChatLibraryOriginal } from "./use-chat-library-original";
import "./chat-library-results.css";
import "./chat-library-image.css";

function Result({
  file,
  archived,
  active,
  actions,
}: {
  file: SavedFile;
  archived: boolean;
  active: boolean;
  actions: LibraryResultActions;
}) {
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
  const copy = (
    <span data-cx="chat-library-result-copy">
      <strong>{saved.name}</strong>
      <small>
        {savedOrigin(saved)} ·{" "}
        {saved.width && saved.height
          ? `${saved.width} × ${saved.height}`
          : saved.kind === "office"
            ? "Office original"
            : "Safe text"}{" "}
        · Saved
      </small>
    </span>
  );
  const art =
    saved.kind === "image" && saved.state === "ready" ? (
      <ChatLibraryImage file={saved} thumbnail active={active} onState={onState} />
    ) : (
      <span data-cx="chat-library-result-kind" aria-hidden="true">
        {saved.kind === "image" ? "Image" : saved.kind === "office" ? "Office" : "Aa"}
      </span>
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
        <a
          data-cx="chat-library-result-card"
          href={savedOriginalUrl(saved)}
          download={saved.name}
          aria-label={`Download ${savedIdentityLabel(saved)}`}
        >
          {art}
          {copy}
        </a>
      ) : (
        <div data-cx="chat-library-result-card">
          {art}
          {copy}
        </div>
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
  ...actions
}: LibraryResultActions & {
  files: readonly SavedFile[];
  archived: boolean;
  active?: boolean;
}) {
  return (
    <div data-cx="chat-library-results">
      {files.map((file) => (
        <Result key={file.id} file={file} archived={archived} active={active} actions={actions} />
      ))}
    </div>
  );
}
