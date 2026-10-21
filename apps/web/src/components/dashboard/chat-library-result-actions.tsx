import { savedOriginalUrl } from "@/lib/chat-library-api";
import type { SavedFile } from "@/lib/chat-library-types";
import { Icon } from "./icon";
import Tooltip from "./tooltip";

const DownloadIcon = () => (
  <svg
    data-cx="icon"
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 5v14m-7-7 7 7 7-7" />
  </svg>
);

export type LibraryResultActions = {
  onOpenImage: (file: SavedFile) => void;
  onPrepareReference: (file: SavedFile) => void;
  onOpenSource: (fileId: string) => void;
  onUnavailable?: (fileId: string, error: string) => void;
};

export function ChatLibraryResultActions({
  file,
  archived,
  readable,
  actions,
}: {
  file: SavedFile;
  archived: boolean;
  readable: boolean;
  actions: LibraryResultActions;
}) {
  return (
    <div data-cx="chat-library-result-actions" aria-label={`Actions for ${file.name}`}>
      {file.kind === "image" && (
        <Tooltip label="Open image">
          <button
            type="button"
            aria-label={`Open ${file.name}`}
            onClick={() => actions.onOpenImage(file)}
          >
            <Icon name="maximize" />
          </button>
        </Tooltip>
      )}
      <Tooltip label={file.kind === "image" ? "Prepare edit" : "Add to draft"}>
        <button
          type="button"
          disabled={archived || !readable}
          aria-label={`${file.kind === "image" ? "Prepare edit of" : "Add to draft"} ${file.name}`}
          onClick={() => actions.onPrepareReference(file)}
        >
          <Icon name="square-pen" />
        </button>
      </Tooltip>
      {file.sources.map((id, index) => (
        <Tooltip key={`${index}/${id}`} label={`Open source ${index + 1}`}>
          <button
            type="button"
            aria-label={`Open source ${index + 1} of ${file.name}, file ${id}`}
            onClick={() => actions.onOpenSource(id)}
          >
            <Icon name="git-branch" />
          </button>
        </Tooltip>
      ))}
      <Tooltip label="Download original">
        {readable ? (
          <a
            href={savedOriginalUrl(file)}
            download={file.name}
            aria-label={`Download original ${file.name}`}
          >
            <DownloadIcon />
          </a>
        ) : (
          <button type="button" disabled aria-label={`Download original ${file.name}`}>
            <DownloadIcon />
          </button>
        )}
      </Tooltip>
    </div>
  );
}
