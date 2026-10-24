import type { SavedFile } from "@/lib/chat-library-types";
import { ChatLibraryImage, type LibraryImageState } from "./chat-library-image";
import { AttachmentArt } from "./attachment-preview";
import { AttachmentFallback } from "./attachment-fallback";
import "./chat-library-image.css";

/** Compact toolbar/picker thumbnail; original decode holds the global image lease. */
export function ChatLibraryThumbnail({
  file,
  active = true,
  onState,
}: {
  file: SavedFile;
  active?: boolean;
  onState?: ((state: LibraryImageState) => void) | undefined;
}) {
  return (
    <span data-cx="chat-library-thumbnail" aria-hidden="true">
      {file.kind === "image" && file.state === "ready" ? (
        <ChatLibraryImage file={file} thumbnail active={active} onState={onState} />
      ) : file.state === "ready" ? (
        <AttachmentArt source={file} active={active} />
      ) : (
        <span data-cx="chat-library-kind">
          <AttachmentFallback />
        </span>
      )}
    </span>
  );
}
