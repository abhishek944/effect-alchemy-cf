import type { SavedFile } from "@/lib/chat-library-types";
import { ChatLibraryImage, type LibraryImageState } from "./chat-library-image";
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
      ) : (
        <span data-cx="chat-library-kind">
          {file.kind === "image" ? "Image" : file.kind === "office" ? "Office" : "Aa"}
        </span>
      )}
    </span>
  );
}
