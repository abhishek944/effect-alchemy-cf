import { useEffect, useMemo, useRef, useState } from "react";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import type { PreviewFile, PreviewLease } from "./chat-file-preview-types";
import { usePinnedImage, type PinnedImageState } from "./chat-pinned-image";
import { usePreviewReservation } from "./use-preview-reservation";
import { AttachmentFallback } from "./attachment-fallback";

export type LibraryImageState = PinnedImageState | "withheld";

function Pinned({
  file,
  lease,
  thumbnail,
  onState,
}: {
  file: PreviewFile;
  lease: PreviewLease;
  thumbnail: boolean;
  onState?: ((state: LibraryImageState) => void) | undefined;
}) {
  const { imgRef, state } = usePinnedImage(file.url, lease);
  useEffect(() => onState?.(state), [onState, state]);
  return (
    <>
      <img ref={imgRef} alt={file.name} data-state={state} />
      {state !== "ready" && (
        <output data-cx="chat-library-image-status">
          {thumbnail ? (
            <AttachmentFallback />
          ) : state === "loading" ? (
            "Loading image…"
          ) : (
            "Image unavailable"
          )}
        </output>
      )}
    </>
  );
}

export type ChatLibraryImageProps = {
  file: SavedFile;
  thumbnail?: boolean;
  /** Hidden panes release mounted displays without discarding view state. */
  active?: boolean;
  attempt?: number;
  onState?: ((state: LibraryImageState) => void) | undefined;
};

/** Each explicit retry takes a fresh bounded lease, even after budget withholding. */
export function ChatLibraryImage(props: ChatLibraryImageProps) {
  return (
    <ImageAttempt key={`${props.file.chatId}/${props.file.id}/${props.attempt ?? 0}`} {...props} />
  );
}

function ImageAttempt({ file, thumbnail = false, active = true, onState }: ChatLibraryImageProps) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  const preview = useMemo<PreviewFile>(
    () => ({
      ...file,
      url: file.state === "ready" && file.kind === "image" ? savedOriginalUrl(file) : null,
      loadText: null,
      readOnly: true,
      reserved: false,
      reservationKey: null,
    }),
    [file],
  );
  const previews = useMemo(() => [preview], [preview]);
  const reservation = usePreviewReservation(previews);
  const { select, close } = reservation;

  useEffect(() => {
    const node = container.current;
    if (!thumbnail || !node) return undefined;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbnail]);

  useEffect(() => {
    if (!active || !visible || !preview.url) return undefined;
    select(0);
    return close;
  }, [active, visible, preview.url, select, close]);

  useEffect(() => {
    if (active && visible && !reservation.allowed) onState?.("withheld");
  }, [active, visible, reservation.allowed, onState]);

  return (
    <span ref={container} data-cx="chat-library-image" data-thumbnail={thumbnail}>
      {active && visible && reservation.lease && reservation.allowed && preview.url ? (
        <Pinned file={preview} lease={reservation.lease} thumbnail={thumbnail} onState={onState} />
      ) : (
        <span data-cx="chat-library-image-status" title={reservation.withheldReason ?? undefined}>
          {thumbnail ? <AttachmentFallback /> : (reservation.withheldReason ?? "Loading image…")}
        </span>
      )}
    </span>
  );
}
