import type { LibraryFilters } from "@/lib/chat-library-types";
import { useId } from "react";
import { DropdownSelect } from "./dropdown";
import { Icon } from "./icon";
import SearchField from "./search-field";
import "./chat-library-query.css";

export function ChatLibraryQuery({
  filters,
  onChange,
  onRefresh,
  refreshing,
}: {
  filters: LibraryFilters;
  onChange: (filters: LibraryFilters) => void;
  onRefresh: () => void;
  refreshing: boolean;
}) {
  const searchId = useId();
  const update = (patch: Partial<LibraryFilters>) => onChange({ ...filters, ...patch });
  return (
    <div data-cx="chat-library-query">
      <div data-cx="chat-library-search">
        <SearchField
          id={searchId}
          label="Search files by name"
          placeholder="Search by name"
          maxLength={120}
          value={filters.search}
          onChange={(search) => update({ search })}
        />
      </div>
      <div data-cx="chat-library-filters">
        <DropdownSelect
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
        </DropdownSelect>
        <DropdownSelect
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
        </DropdownSelect>
        <div data-cx="chat-library-sort">
          <DropdownSelect
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
          </DropdownSelect>
          <button
            data-cx="chat-library-refresh"
            type="button"
            aria-label="Refresh files"
            title="Refresh files"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <Icon name="refresh-cw" />
          </button>
        </div>
      </div>
    </div>
  );
}
