import { useState } from "react";
import { formatFileSize } from "@/lib/chat-file-local";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import { isNativeOpenFile } from "@/lib/office-original";
import { AttachmentArt, AttachmentPreview } from "./attachment-preview";
import { savedIdentityLabel, savedTime } from "./chat-library-format";
import { DownloadIcon } from "./chat-library-result-actions";
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
  const [preview, setPreview] = useState(false);
  if (!active && preview) setPreview(false);
  const ready = saved.state === "ready";
  const open = () => (saved.kind === "image" ? onOpenImage(saved.id) : setPreview(true));
  return (
    <div data-cx="chat-library-item">
      <button
        type="button"
        data-cx="chat-library-card"
        aria-label={`Preview ${savedIdentityLabel(saved)}`}
        onClick={open}
        disabled={!ready}
      >
        {ready ? (
          <AttachmentArt source={saved} active={active} />
        ) : (
          <span data-cx="chat-library-kind">Original unavailable</span>
        )}
        <strong>{saved.name}</strong>
        <small>
          {savedTime(saved)} · {formatFileSize(saved.byteSize)}
        </small>
      </button>
      {ready ? (
        <a
          data-cx="chat-library-download-label"
          href={savedOriginalUrl(saved)}
          download={saved.name}
          aria-label={`Download ${saved.name}`}
          title={`Download ${saved.name}`}
        >
          <DownloadIcon />
        </a>
      ) : (
        <div>
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
      )}
      {preview && active && (
        <AttachmentPreview
          source={saved}
          onClose={() => setPreview(false)}
          onOpenOffice={
            isNativeOpenFile(saved)
              ? () => {
                  setPreview(false);
                  onOpenImage(saved.id);
                }
              : undefined
          }
        />
      )}
    </div>
  );
}
