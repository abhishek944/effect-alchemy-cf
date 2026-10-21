import { useEffect, useState } from "react";
import { formatFileSize } from "@/lib/chat-file-local";
import { useImageBudget } from "./chat-image-budget";
import { usePinnedImage } from "./chat-pinned-image";
import type { PreviewFile, PreviewLease } from "./chat-file-preview-types";

type Loaded = { key: string; state: "ready" | "error"; text: string };

export function TextPanel({
  file,
  lease = null,
  allowed = true,
  withheldReason = null,
}: {
  file: PreviewFile;
  lease?: PreviewLease | null;
  allowed?: boolean;
  withheldReason?: string | null;
}) {
  const budget = useImageBudget();
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${file.id}|${attempt}`;
  const loadText = file.loadText;
  const leaseKey = lease?.key ?? null;
  const previewBytes = lease?.previewBytes ?? 0;

  useEffect(() => {
    if (!loadText || !allowed) return undefined;
    let active = true;
    let pinned = false;
    const release = () => {
      if (!pinned) return;
      pinned = false;
      if (leaseKey !== null) budget.release(leaseKey);
    };
    const run = async () => {
      try {
        if (leaseKey !== null && !budget.retain(leaseKey, 0, previewBytes))
          throw new Error("budget");
        pinned = true;
        const value = await loadText();
        if (active) setLoaded({ key, state: "ready", text: value });
      } catch {
        if (active) setLoaded({ key, state: "error", text: "" });
      } finally {
        // The pin lives until this exact load settles, even after unmount.
        release();
      }
    };
    void run();
    return () => {
      // Cleanup only stale-fences state; it never frees pending capacity.
      active = false;
    };
  }, [allowed, budget, key, leaseKey, loadText, previewBytes]);

  if (!allowed)
    return <output data-cx="preview-status">{withheldReason ?? "Preview withheld."}</output>;
  const current = loaded?.key === key ? loaded : null;
  if (!current)
    return (
      <output data-cx="preview-status">{loadText ? "Loading text…" : "Text unavailable."}</output>
    );
  if (current.state === "error")
    return (
      <div data-cx="preview-status" role="alert">
        <span>This text could not be loaded.</span>
        <button type="button" data-cx="preview-action" onClick={() => setAttempt((v) => v + 1)}>
          Retry preview
        </button>
      </div>
    );
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard scrolling of long preview text.
    <pre data-cx="preview-text" tabIndex={0}>
      {current.text}
    </pre>
  );
}

/** One pinned image attempt; remounted by source+attempt so retry re-pins. */
function PinnedImageAttempt({
  file,
  lease,
  onRetry,
}: {
  file: PreviewFile;
  lease: PreviewLease | null;
  onRetry: () => void;
}) {
  const { state, imgRef } = usePinnedImage(file.url, lease);
  return (
    <>
      <img
        key={file.url}
        ref={imgRef}
        data-cx="preview-image"
        alt={`Preview of ${file.name}`}
        data-state={state}
      />
      {state === "loading" && <output data-cx="preview-status">Loading image…</output>}
      {state === "error" && (
        <div data-cx="preview-status" role="alert">
          <span>This image could not be loaded.</span>
          <button type="button" data-cx="preview-action" onClick={onRetry}>
            Retry preview
          </button>
        </div>
      )}
    </>
  );
}

export function ImagePanel({
  file,
  lease = null,
  allowed = true,
  withheldReason = null,
}: {
  file: PreviewFile;
  lease?: PreviewLease | null;
  allowed?: boolean;
  withheldReason?: string | null;
}) {
  const [attempt, setAttempt] = useState(0);
  if (!allowed)
    return <output data-cx="preview-status">{withheldReason ?? "Preview withheld."}</output>;
  if (!file.url)
    return (
      <div data-cx="preview-status" role="alert">
        <span>This image has no readable original.</span>
      </div>
    );
  return (
    <div data-cx="preview-image-wrap">
      <PinnedImageAttempt
        key={`${file.url}|${attempt}`}
        file={file}
        lease={lease}
        onRetry={() => setAttempt((value) => value + 1)}
      />
    </div>
  );
}

export function previewMeta(file: PreviewFile): string {
  return `${file.mediaType} · ${formatFileSize(file.byteSize)}${
    file.width && file.height ? ` · ${file.width}×${file.height}` : ""
  }${file.readOnly ? " · Read-only sent original" : " · Local until Send"}`;
}

/** Office originals are opaque until Send; this panel never reads binary bytes. */
export function OfficePanel({ file }: { file: PreviewFile }) {
  return (
    <div data-cx="preview-status">
      <strong>Office file original</strong>
      <span>
        {file.name} · {formatFileSize(file.byteSize)} · uploads unchanged on Send.
      </span>
    </div>
  );
}
