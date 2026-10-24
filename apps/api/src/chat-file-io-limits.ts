import { withCause, withDiagnostic } from "@starter/diagnostics";
import {
  MAX_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_OFFICE_BYTES,
  type FileKind,
} from "./chat-attachment-schema.ts";

export class ChatFileIOUnavailable extends Error {
  constructor() {
    super("Private file I/O is unavailable.");
    this.name = "ChatFileIOUnavailable";
  }
}

/** Fixed file I/O failure kinds; no paths, keys, names or contents. */
export type FileIOReason = "storage" | "metadata" | "integrity" | "limit" | "abort";

/** Typed file I/O failure preserving the adapter cause and fixed kind. */
export const fileIOUnavailable = (reason: FileIOReason, cause?: unknown): ChatFileIOUnavailable => {
  const error = withDiagnostic(new ChatFileIOUnavailable(), reason);
  return cause === undefined ? error : withCause(error, cause);
};
export const fileByteLimit = (kind: FileKind): number =>
  kind === "image" ? MAX_IMAGE_BYTES : kind === "office" ? MAX_OFFICE_BYTES : MAX_TEXT_FILE_BYTES;
