import { useMemo } from "react";
import { formatFileSize, type LocalFile } from "@/lib/chat-file-local";
import ChatFilePreview, { type PreviewFile } from "./chat-file-preview";
import ChatIcon from "./chat-icon";
import FileThumbnail from "./chat-file-thumbnail";
import { usePreviewReservation } from "./use-preview-reservation";
import "./chat-file-rows.css";

const STATE_LABEL: Record<LocalFile["state"], string> = {
  preparing: "Preparing…",
  ready: "Ready · Local",
  uploading: "Uploading…",
  upload_failed: "Upload failed",
  unsupported: "Not supported",
  failed: "Failed",
};

function toPreview(file: LocalFile): PreviewFile {
  const readable = file.state === "ready";
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    width: file.width,
    height: file.height,
    url: file.kind === "image" && readable ? file.previewUrl : null,
    loadText: file.kind === "text" && readable ? () => file.file.text() : null,
    // The row's actual lease key is reused by the inspector/thumbnail pins.
    reserved: file.kind === "image" && readable && file.reservationKey !== null,
    reservationKey: file.kind === "image" && readable ? file.reservationKey : null,
    readOnly: false,
  };
}

function FileRow({
  file,
  locked,
  onPreview,
  onRemove,
  onRetry,
}: {
  file: LocalFile;
  locked: boolean;
  onPreview: () => void;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const failed = file.state === "failed" || file.state === "unsupported";
  const retryable = failed || file.state === "upload_failed";
  const previewable = !failed && (file.kind === "text" || Boolean(file.previewUrl));
  const lockNote = locked ? "Waiting for the frozen send to settle." : undefined;
  return (
    <li data-cx="file-row" data-state={file.state}>
      <button
        type="button"
        data-cx="file-preview-button"
        aria-label={`Preview ${file.name}`}
        onClick={onPreview}
      >
        {file.kind === "image" && file.previewUrl ? (
          <FileThumbnail file={file} />
        ) : (
          <span data-cx="file-kind" aria-hidden="true">
            <ChatIcon name="copy" />
          </span>
        )}
      </button>
      <div data-cx="file-body">
        <span data-cx="file-name">{file.name}</span>
        <small data-cx="file-meta">
          {formatFileSize(file.byteSize)} · {STATE_LABEL[file.state]}
          {file.width && file.height ? ` · ${file.width}×${file.height}` : ""}
          {file.previewLimited ? " · Thumbnail withheld (tab memory budget)" : ""}
          {file.error ? ` — ${file.error}` : ""}
        </small>
        {file.kind === "text" && file.excerpt && (
          <small data-cx="file-excerpt">{file.excerpt}</small>
        )}
      </div>
      <div data-cx="file-actions">
        {previewable && (
          <button
            type="button"
            data-cx="file-action"
            onClick={onPreview}
            aria-label={`Preview ${file.name}`}
          >
            Preview
          </button>
        )}
        {retryable && (
          <button
            type="button"
            data-cx="file-action"
            onClick={onRetry}
            aria-label={`Retry ${file.name}`}
            disabled={locked}
            title={lockNote}
          >
            Retry
          </button>
        )}
        <button
          type="button"
          data-cx="file-action"
          onClick={onRemove}
          aria-label={`Remove ${file.name}`}
          disabled={locked}
          title={lockNote}
        >
          Remove
        </button>
      </div>
    </li>
  );
}

/** Compact staged rows inside the composer, above the recording region. */
export default function ChatComposerFiles({
  files,
  lockedIds,
  notice,
  onRemove,
  onRetry,
  onClearNotice,
}: {
  files: LocalFile[];
  lockedIds: readonly string[];
  notice: string | null;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
  onClearNotice: () => void;
}) {
  const previews = useMemo(() => files.map(toPreview), [files]);
  const preview = usePreviewReservation(previews);
  if (files.length === 0) return null;
  const total = files.reduce((sum, file) => sum + file.byteSize, 0);
  return (
    <section data-cx="composer-files" aria-label="Files added to this message">
      <header data-cx="files-head">
        <span>
          {files.length} {files.length === 1 ? "file" : "files"} · {formatFileSize(total)}
        </span>
        <span data-cx="files-local">Local until Send</span>
      </header>
      <ul data-cx="file-list">
        {files.map((file, index) => (
          <FileRow
            key={file.id}
            file={file}
            locked={lockedIds.includes(file.id)}
            onPreview={() => preview.select(index)}
            onRemove={() => onRemove(file.id)}
            onRetry={() => onRetry(file.id)}
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
      {preview.index !== null && (
        <ChatFilePreview
          files={previews}
          index={preview.index}
          allowed={preview.allowed}
          withheldReason={preview.withheldReason}
          lease={preview.lease}
          onIndexChange={(index) => preview.select(index)}
          onClose={preview.close}
        />
      )}
    </section>
  );
}
