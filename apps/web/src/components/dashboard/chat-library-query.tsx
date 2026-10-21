import type { LibraryFilters } from "@/lib/chat-library-types";
import { Icon } from "./icon";
import "./chat-library-query.css";

export function ChatLibraryQuery({
  filters,
  onChange,
}: {
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
}) {
  const update = (patch: Partial<LibraryFilters>) => onChange({ ...filters, ...patch });
  return (
    <div data-cx="chat-library-query">
      <label data-cx="chat-library-search">
        <Icon name="search" />
        <input
          type="search"
          aria-label="Search files by name"
          placeholder="Search by name"
          maxLength={120}
          value={filters.search}
          onChange={(event) => update({ search: event.target.value })}
        />
      </label>
      <div data-cx="chat-library-filters">
        <select
          aria-label="File kind"
          value={filters.kind}
          onChange={(event) => {
            const kind = event.target.value;
            if (kind === "all" || kind === "image" || kind === "text") update({ kind });
          }}
        >
          <option value="all">All kinds</option>
          <option value="image">Images</option>
          <option value="text">Text / code</option>
        </select>
        <select
          aria-label="File origin"
          value={filters.origin}
          onChange={(event) => {
            const origin = event.target.value;
            if (origin === "all" || origin === "upload" || origin === "generated")
              update({ origin });
          }}
        >
          <option value="all">All origins</option>
          <option value="upload">Uploaded</option>
          <option value="generated">Generated</option>
        </select>
        <select
          aria-label="Sort files"
          value={filters.sort}
          onChange={(event) => {
            const sort = event.target.value;
            if (sort === "newest" || sort === "oldest" || sort === "name") update({ sort });
          }}
        >
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="name">Name</option>
        </select>
      </div>
    </div>
  );
}
