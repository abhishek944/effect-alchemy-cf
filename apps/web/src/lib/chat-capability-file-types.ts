/** Safe file display metadata; originals have no application capacity quota. */
export const MAX_EXCERPT_CHARS = 2_000;
export const ABANDONED_UPLOAD_TTL_MS = 86_400_000;

export type FileKind = "image" | "text" | "office";
export type FileState = "uploading" | "ready" | "failed" | "expired" | "unavailable";

export type ChatFileDescriptor = {
  id: string;
  chatId: string;
  kind: FileKind;
  /** Sanitized display name; never a storage path. */
  name: string;
  mediaType: string;
  byteSize: number;
  state: FileState;
  width: number | null;
  height: number | null;
  excerpt: string | null;
  createdAt: string;
  expiresAt: string | null;
};

export type ChatFileDescriptorList = { chatId: string; files: ChatFileDescriptor[] };

export const FILE_KINDS: readonly FileKind[] = ["image", "text", "office"];
export const FILE_STATES: readonly FileState[] = [
  "uploading",
  "ready",
  "failed",
  "expired",
  "unavailable",
];
