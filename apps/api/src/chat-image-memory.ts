import { ImageIOError } from "./chat-image-io-error.ts";
import {
  estimateImageMemory,
  IMAGE_MEMORY_BUDGET_BYTES,
  type ImageMemoryEstimate,
  type ImageMemoryRequest,
} from "./chat-image-memory-estimate.ts";

export {
  estimateImageMemory,
  IMAGE_MEMORY_BUDGET_BYTES,
  IMAGE_RESPONSE_ENVELOPE_BYTES,
  IMAGE_STORAGE_COPY_PROFILES,
  type ImageMemoryEstimate,
  type ImageMemoryRequest,
  type ImageStorageCopyProfile,
} from "./chat-image-memory-estimate.ts";

export type ImageMemoryLease = ImageMemoryEstimate & {
  /** Claim before loading an occurrence; credit is retained for the whole call. */
  claim(kind: "original" | "output" | "response", bytes: number): void;
  /** Start actual work here, not an already-running or abort-raced promise. */
  track<T>(work: () => Promise<T>): Promise<T>;
  /** Close admission now; release only when every tracked operation has settled. */
  releaseWhenSettled(): void;
};

// Shared by all consumers in this module's isolate, not per conversation/tool.
let reserved = 0;
let leases = 0;

/** Server diagnostics only; never a persistent user-facing storage meter. */
export const imageMemoryUsage = (): {
  readonly reservedBytes: number;
  readonly leases: number;
} => ({
  reservedBytes: reserved,
  leases,
});

/** No queue, timer, count cap or automatic retry. Null means byte capacity is busy. */
export const tryReserveImageMemory = (input: ImageMemoryRequest): ImageMemoryLease | null => {
  const estimate = estimateImageMemory(input);
  if (estimate.bytes > IMAGE_MEMORY_BUDGET_BYTES - reserved) return null;
  reserved += estimate.bytes;
  leases += 1;
  let pending = 0;
  let closing = false;
  let released = false;
  let originalClaims = 0;
  let outputClaims = 0;
  let responseClaims = 0;
  const open = (): void => {
    if (closing) throw new ImageIOError("lease_closed", "The image memory lease is closed.");
  };
  const finish = (): void => {
    if (!closing || pending !== 0 || released) return;
    released = true;
    reserved -= estimate.bytes;
    leases -= 1;
  };
  const settled = (): void => {
    pending -= 1;
    finish();
  };
  return Object.freeze({
    ...estimate,
    claim(kind: "original" | "output" | "response", bytes: number): void {
      open();
      const used =
        kind === "original" ? originalClaims : kind === "output" ? outputClaims : responseClaims;
      const limit =
        kind === "original"
          ? estimate.originalBytes
          : kind === "output"
            ? estimate.outputBytes
            : estimate.responseBytes;
      if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > limit - used)
        throw new ImageIOError(
          "lease_capacity",
          "This read exceeds its reserved image byte capacity.",
        );
      if (kind === "original") originalClaims += bytes;
      else if (kind === "output") outputClaims += bytes;
      else responseClaims += bytes;
    },
    track<T>(work: () => Promise<T>): Promise<T> {
      open();
      pending += 1;
      return Promise.resolve()
        .then(work)
        .then(
          (value) => {
            settled();
            return value;
          },
          (error: unknown) => {
            settled();
            throw error;
          },
        );
    },
    releaseWhenSettled(): void {
      closing = true;
      finish();
    },
  });
};
