import { useState } from "react";
import { formatFileSize, type LocalFile } from "@/lib/chat-file-local";
import { AttachmentArt, AttachmentPreview } from "./attachment-preview";
import { useHistoryText } from "./chat-history-ui";
import { AttachmentFallback } from "./attachment-fallback";
import "./chat-file-rows.css";

function FileRow({
  file,
  locked,
  active,
  onRemove,
}: {
  file: LocalFile;
  locked: boolean;
  active: boolean;
  onRemove: () => void;
}) {
  const [preview, setPreview] = useState(false);
  if (!active && preview) setPreview(false);
  const previewable =
    file.state === "ready" || file.state === "uploading" || file.state === "upload_failed";
  const failed =
    file.state === "failed" || file.state === "unsupported" || file.state === "upload_failed";
  const error = failed ? (file.error ?? "This file could not be prepared or uploaded.") : null;
  return (
    <li
      data-cx="file-row"
      data-state={file.state}
      aria-busy={file.state === "preparing" || file.state === "uploading"}
    >
      <button
        type="button"
        data-cx="attachment-trigger"
        aria-label={`Preview ${file.name}`}
        disabled={!previewable || !active}
        onClick={() => setPreview(true)}
      >
        {previewable ? <AttachmentArt source={file} active={active} /> : <AttachmentFallback />}
      </button>
      {preview && active && <AttachmentPreview source={file} onClose={() => setPreview(false)} />}
      <div data-cx="file-body">
        <span data-cx="file-name" title={file.name}>
          {file.name}
        </span>
        <small data-cx="file-meta">{formatFileSize(file.byteSize)}</small>
        {error && <output data-cx="file-error">{error}</output>}
      </div>
      <div data-cx="file-actions">
        <button
          type="button"
          data-cx="file-action"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          disabled={locked}
          title={locked ? "Waiting for the frozen send to settle." : undefined}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/** Local content previews do not upload files or import Office drafts. */
export default function ChatComposerFiles({
  files,
  lockedIds,
  notice,
  onRemove,
  onClearNotice,
}: {
  files: LocalFile[];
  lockedIds: readonly string[];
  notice: string | null;
  onRemove: (id: string) => void;
  onClearNotice: () => void;
}) {
  const { active } = useHistoryText();
  if (files.length === 0) return null;
  return (
    <section data-cx="composer-files" aria-label="Files added to this message">
      <ul data-cx="file-list">
        {files.map((file) => (
          <FileRow
            key={file.id}
            file={file}
            locked={lockedIds.includes(file.id)}
            active={active}
            onRemove={() => onRemove(file.id)}
          />
        ))}
      </ul>
      {notice && (
        <output data-cx="files-notice">
          {notice}
          <button type="button" data-cx="file-action" onClick={onClearNotice}>
            Dismiss
          </button>
        </output>
      )}
    </section>
  );
}
