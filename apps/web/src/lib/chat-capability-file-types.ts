/** Safe file display metadata and bounded browser attachment budgets. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 5;
export const MAX_IMAGE_BYTES = 10_485_760;
export const MAX_IMAGE_PIXELS = 16_000_000;
export const MAX_TEXT_FILE_BYTES = 1_048_576;
export const MAX_OFFICE_BYTES = 10_485_760;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 20_971_520;
export const MAX_QUOTED_TEXT_CHARS = 100_000;
export const MAX_EXCERPT_CHARS = 2_000;
export const RETAINED_BYTES_PER_USER = 1_073_741_824;
export const ABANDONED_UPLOAD_TTL_MS = 86_400_000;
export const LOCAL_DRAFT_BYTES_PER_TAB = 41_943_040;
export const PREVIEW_CACHE_BYTES = 20_971_520;
export const PREVIEW_DECODED_BYTES = 67_108_864;

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
