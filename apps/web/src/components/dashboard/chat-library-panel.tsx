import type { LibraryFilters } from "@/lib/chat-library-types";
import { Icon } from "./icon";
import { ChatLibraryCard } from "./chat-library-card";
import { ChatLibraryQuery } from "./chat-library-query";
import type { ChatLibrary } from "./use-chat-library";
import "./chat-library-panel.css";
import "./chat-library-image.css";

export type ChatLibraryPanelProps = {
  library: ChatLibrary;
  chatTitle: string;
  archived: boolean;
  /** Keep mounted/hidden to retain query+scroll; false releases original display leases. */
  active: boolean;
  onOpenImage: (fileId: string) => void;
  onRefresh: () => void;
};

export function ChatLibraryPanel({
  library,
  chatTitle,
  archived,
  active,
  onOpenImage,
  onRefresh,
}: ChatLibraryPanelProps) {
  const update = (patch: Partial<LibraryFilters>) =>
    library.setFilters({ ...library.filters, ...patch });
  const filtered =
    library.filters.search !== "" ||
    library.filters.kind !== "all" ||
    library.filters.origin !== "all";
  return (
    <section data-cx="chat-library-panel" aria-label={`Files in ${chatTitle}`} hidden={!active}>
      {archived && (
        <p data-cx="chat-library-banner">
          <Icon name="archive" />
          Archived chat · View and download only
        </p>
      )}
      <ChatLibraryQuery
        filters={library.filters}
        onChange={library.setFilters}
        onRefresh={onRefresh}
        refreshing={library.state === "loading" || !active}
      />
      <div data-cx="chat-library-grid" aria-busy={library.state === "loading"}>
        {library.state === "loading" && (
          <div data-cx="chat-library-state" aria-live="polite">
            Loading saved files…
          </div>
        )}
        {library.state === "error" && (
          <div data-cx="chat-library-state" role="alert">
            <strong>Could not load files</strong>
            <p>{library.error}</p>
            <button type="button" onClick={library.retry}>
              Retry loading files
            </button>
          </div>
        )}
        {library.state === "ready" && library.files.length === 0 && filtered && (
          <div data-cx="chat-library-state" aria-live="polite">
            <strong>No matching files</strong>
            <p>Try another name or clear your filters.</p>
            <button
              type="button"
              onClick={() => update({ search: "", kind: "all", origin: "all" })}
            >
              Clear search and filters
            </button>
          </div>
        )}
        {library.files.map((file) => (
          <ChatLibraryCard key={file.id} file={file} active={active} onOpenImage={onOpenImage} />
        ))}
      </div>
      {(!library.isFirst || library.hasNext) && (
        <nav data-cx="chat-library-pages" aria-label="Saved file pages">
          <button type="button" disabled={library.isFirst} onClick={library.first}>
            First page
          </button>
          <button
            type="button"
            disabled={!library.hasPrevious || library.state === "loading"}
            onClick={library.previous}
          >
            Previous
          </button>
          <button
            type="button"
            disabled={!library.hasNext || library.state !== "ready"}
            onClick={library.next}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  );
}
