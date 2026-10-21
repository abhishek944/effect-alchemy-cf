import type { ChatFileDescriptor } from "./chat-capability-file-types";

/** Browser-safe immutable saved metadata; never original bytes or storage URLs. */
export type SavedFile = ChatFileDescriptor & {
  origin: "upload" | "generated";
  sources: readonly string[];
  generation: null | { callId: string; operationId: string };
};

export type LibraryQuery = {
  search?: string;
  kind?: "all" | "image" | "text";
  origin?: "all" | "upload" | "generated";
  sort?: "newest" | "oldest" | "name";
  cursor?: string;
  limit?: number;
};

export type LibraryFilters = Required<Pick<LibraryQuery, "search" | "kind" | "origin" | "sort">>;
export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = {
  search: "",
  kind: "all",
  origin: "all",
  sort: "newest",
};

export type SavedLibraryPage = {
  chatId: string;
  files: readonly SavedFile[];
  nextCursor: string | null;
};

export type LibraryReadState = "loading" | "ready" | "error";
export type ReferenceRead = {
  state: "reading" | "ready" | "error";
  error: string | null;
};
