import { useEffect, useRef, useState } from "react";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import { usePinnedImage, type PinnedImageState } from "./chat-pinned-image";
import { AttachmentFallback } from "./attachment-fallback";

export type LibraryImageState = PinnedImageState;
export type ChatLibraryImageProps = {
  file: SavedFile;
  thumbnail?: boolean;
  /** Hidden panes release mounted displays without discarding view state. */
  active?: boolean;
  attempt?: number;
  onState?: ((state: LibraryImageState) => void) | undefined;
};

function Pinned({ file, thumbnail, onState }: ChatLibraryImageProps) {
  const { imgRef, state } = usePinnedImage(savedOriginalUrl(file));
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

/** Each retry owns a fresh decode; hidden/offscreen thumbnails do not stay mounted. */
export function ChatLibraryImage(props: ChatLibraryImageProps) {
  return (
    <ImageAttempt key={`${props.file.chatId}/${props.file.id}/${props.attempt ?? 0}`} {...props} />
  );
}

function ImageAttempt({ file, thumbnail = false, active = true, onState }: ChatLibraryImageProps) {
  const container = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(!thumbnail);
  useEffect(() => {
    const node = container.current;
    if (!thumbnail || !node) return undefined;
    const observer = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [thumbnail]);
  return (
    <span ref={container} data-cx="chat-library-image" data-thumbnail={thumbnail}>
      {active && visible && file.state === "ready" && file.kind === "image" ? (
        <Pinned file={file} thumbnail={thumbnail} onState={onState} />
      ) : (
        <span data-cx="chat-library-image-status">
          {thumbnail ? <AttachmentFallback /> : "Image unavailable"}
        </span>
      )}
    </span>
  );
}
