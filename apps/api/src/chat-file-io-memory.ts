import { tryReserveImageMemory, type ImageMemoryLease } from "./chat-image-memory.ts";
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
export const fileByteLimit = (kind: FileKind): number =>
  kind === "image" ? MAX_IMAGE_BYTES : kind === "office" ? MAX_OFFICE_BYTES : MAX_TEXT_FILE_BYTES;

/** Same isolate pool as native/generation; Office bytes use the bounded original lease. */
export const withFileMemory = async <T>(
  kind: FileKind,
  bytes: number,
  work: (lease: ImageMemoryLease) => Promise<T>,
): Promise<T> => {
  if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > fileByteLimit(kind))
    throw new ChatFileIOUnavailable();
  const lease = tryReserveImageMemory({
    purpose: "original",
    originals: [{ kind, byteSize: bytes }],
  });
  if (lease === null) throw new ChatFileIOUnavailable();
  try {
    lease.claim("original", bytes);
    return await lease.track(() => work(lease));
  } finally {
    // A response/stream may still own an additional pending track after headers resolve.
    lease.releaseWhenSettled();
  }
};
