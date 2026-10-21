import {
  MAX_IMAGE_BYTES,
  MAX_TEXT_FILE_BYTES,
  MAX_OFFICE_BYTES,
} from "./chat-attachment-schema.ts";
import { ImageIOError } from "./chat-image-io-error.ts";

/** Host policy, NOT measured heap. Other SDK/global I/O must fit the remaining 32 MiB. */
export const IMAGE_MEMORY_BUDGET_BYTES = 96 * 1024 * 1024;
/** Default asset-ceiling envelope, not an automatically admissible execution profile. */
export const IMAGE_RESPONSE_ENVELOPE_BYTES = 4 * Math.ceil(MAX_IMAGE_BYTES / 3) + 64 * 1024;

/** Includes package Original; stream chunks+concat are TWO payloads, not one. */
export const IMAGE_STORAGE_COPY_PROFILES = Object.freeze({
  "rpc-copied": 6,
  // Use only after verifying client and R2 use guarded exact-range borrowed views.
  "rpc-borrowed": 4,
});
export type ImageStorageCopyProfile = keyof typeof IMAGE_STORAGE_COPY_PROFILES;

type MemoryInput = {
  /** Every hydrated occurrence counts, even repeated use of the same file. */
  readonly originals: readonly {
    readonly kind: "image" | "text" | "office";
    readonly byteSize: number;
  }[];
  /** UTF-16 units of other request text before JSON escaping, not token count. */
  readonly textCharacters?: number;
};
export type ImageMemoryRequest = MemoryInput &
  (
    | {
        readonly purpose: "generation" | "output";
        /** Explicit HOST execution ceiling; must also constrain package imageBytes. */
        readonly outputBytes: number;
        readonly storageProfile: ImageStorageCopyProfile;
        readonly responseBytes?: number;
      }
    | {
        readonly purpose: "hydration" | "original";
        readonly outputBytes?: never;
        readonly storageProfile?: never;
        readonly responseBytes?: never;
      }
  );

export type ImageMemoryEstimate = {
  readonly bytes: number;
  readonly originalBytes: number;
  readonly encodedCharacters: number;
  readonly outputBytes: number;
  readonly responseBytes: number;
  readonly authoredOutputBytes: number;
  readonly platformAllowanceBytes: number;
};

const invalid = (): never => {
  throw new ImageIOError("invalid_memory_estimate", "The image memory estimate is invalid.");
};
const count = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : invalid();
const sum = (...values: number[]): number =>
  count(values.reduce((total, value) => total + value, 0));

/**
 * Aggregate retained allocations, NOT phase maxima or prompt-GC assumptions.
 * Response 8E covers chunks+concat (2E), decoded JSON (2E), parsed image (2E),
 * base64 substring (2E). Add sink's authored payload inventory, an output-loader
 * chunk, and two payloads of UNMEASURED transport/WebCrypto allowance. Root SDK,
 * other I/O, native backing buffers, adversarial JSON object expansion and GC are
 * not proven bounded by this policy. Parent must select/validate an execution
 * envelope before dispatch; the 10 MiB asset ceiling does not fit by default.
 */
export const estimateImageMemory = (input: ImageMemoryRequest): ImageMemoryEstimate => {
  if (!["generation", "hydration", "original", "output"].includes(input.purpose)) invalid();
  let images = 0;
  let text = 0;
  let offices = 0;
  let encoded = 0;
  for (const original of input.originals) {
    const bytes = count(original.byteSize);
    const maximum =
      original.kind === "image"
        ? MAX_IMAGE_BYTES
        : original.kind === "office"
          ? MAX_OFFICE_BYTES
          : MAX_TEXT_FILE_BYTES;
    if (bytes === 0 || bytes > maximum) invalid();
    if (input.purpose === "generation" && original.kind === "image" && bytes > input.outputBytes)
      invalid();
    if (original.kind === "office") {
      if (input.purpose !== "original") invalid();
      offices = sum(offices, bytes);
      continue;
    }
    if (original.kind === "image") {
      images = sum(images, bytes);
      encoded = sum(encoded, 4 * Math.ceil(bytes / 3));
    } else if (original.kind === "text") text = sum(text, bytes);
    else invalid();
  }
  const originalBytes = sum(images, text, offices);
  const characters = count(input.textCharacters ?? 0);
  const generation = input.purpose === "generation";
  const outputBytes = count(input.outputBytes ?? 0);
  const responseBytes = count(
    input.responseBytes ?? (generation ? 4 * Math.ceil(outputBytes / 3) + 64 * 1024 : 0),
  );
  const copies =
    input.storageProfile === undefined ? 0 : IMAGE_STORAGE_COPY_PROFILES[input.storageProfile];
  if (outputBytes > MAX_IMAGE_BYTES || !Number.isSafeInteger(copies)) invalid();
  if (generation && (outputBytes === 0 || responseBytes === 0 || copies === 0)) invalid();
  if (input.purpose === "output" && (outputBytes === 0 || copies === 0)) invalid();
  if (!generation && responseBytes !== 0) invalid();
  if (input.purpose !== "output" && !generation && outputBytes !== 0) invalid();
  const requestCopies = input.purpose === "original" ? 0 : count(9 * encoded);
  // Raw buffer + retained incoming chunks + SHA copy + native crypto/platform allowance.
  // Office is original-only opaque I/O: same four lifetimes, no text decode or JSON.
  const inputAllocations = sum(4 * images, 24 * text, 4 * offices, 16 * characters, requestCopies);
  // Core allocates decoded output BEFORE checking imageBytes; envelope bounds it.
  const decodedOutput = Math.max(
    outputBytes,
    generation ? count(Math.ceil((responseBytes * 3) / 4)) : 0,
  );
  const authoredOutputBytes = count((copies + (outputBytes > 0 ? 1 : 0)) * decodedOutput);
  const platformAllowanceBytes = count(2 * decodedOutput);
  const bytes = sum(
    inputAllocations,
    8 * responseBytes,
    authoredOutputBytes,
    platformAllowanceBytes,
    1024 * 1024,
  );
  return Object.freeze({
    bytes,
    originalBytes,
    encodedCharacters: encoded,
    outputBytes,
    responseBytes,
    authoredOutputBytes,
    platformAllowanceBytes,
  });
};
