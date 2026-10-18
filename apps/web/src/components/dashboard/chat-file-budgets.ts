/**
 * Tab preview/decode budget with globally unique lease keys and refcounts.
 *
 * Each lease can be retained by a primary owner and by any pending native work
 * (image decode, text fetch) on the same key. Capacity is charged once and
 * stays charged while any retain remains, so releasing the owner on
 * close/switch/unmount never frees bytes that an outstanding load still uses.
 * Reservations are keyed by a minted lease, never by a row or public file ID.
 */
import { PREVIEW_CACHE_BYTES, PREVIEW_DECODED_BYTES } from "@/lib/chat-capability-file-types";

type Reservation = { preview: number; decoded: number; count: number };

export type ImageBudget = {
  /** Adds one retain on a lease; capacity is checked only on the first one. */
  retain: (key: string, decodedBytes: number, previewBytes: number) => boolean;
  /** Drops one retain; capacity frees when the last retain ends. */
  release: (key: string) => void;
  previewBytes: () => number;
  decodedBytes: () => number;
};

export function createImageBudget(): ImageBudget {
  const held = new Map<string, Reservation>();
  let preview = 0;
  let decoded = 0;
  return {
    retain: (key, decodedBytes, previewBytes) => {
      const existing = held.get(key);
      if (existing) {
        existing.count += 1;
        return true;
      }
      const nextPreview = preview + previewBytes;
      const nextDecoded = decoded + decodedBytes;
      if (nextPreview > PREVIEW_CACHE_BYTES || nextDecoded > PREVIEW_DECODED_BYTES) return false;
      held.set(key, { preview: previewBytes, decoded: decodedBytes, count: 1 });
      preview = nextPreview;
      decoded = nextDecoded;
      return true;
    },
    release: (key) => {
      const entry = held.get(key);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count > 0) return;
      held.delete(key);
      preview -= entry.preview;
      decoded -= entry.decoded;
    },
    previewBytes: () => preview,
    decodedBytes: () => decoded,
  };
}

/** One budget per document: account/provider remounts never reset ownership. */
export const documentImageBudget: ImageBudget = createImageBudget();

let leaseCounter = 0;

/** Monotonic lease key; a deleted row or reopened inspector never reuses one. */
export function mintImageLease(prefix: string): string {
  leaseCounter += 1;
  return `${prefix}#${leaseCounter}`;
}
