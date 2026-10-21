import { MAX_IMAGE_BYTES, RETAINED_BYTES_PER_USER } from "./chat-attachment-schema.ts";
import { tryReserveImageMemory, type ImageMemoryLease } from "./chat-image-memory.ts";
import { ImageStorageError, type ImageCallKey } from "./chat-image-storage-schema.ts";

type HeldCall = {
  readonly lease: ImageMemoryLease;
  readonly capacity: number;
  pending: number;
  closing: boolean;
};
// Scope survives owner-instance replacement in this isolate; capacity is the shared T27 pool.
const calls = new Map<string, HeldCall>();

export const generatedDeclaredBytes = (request: Request): number => {
  const raw = request.headers.get("x-image-byte-size") ?? request.headers.get("content-length");
  if (raw === null || !/^[1-9][0-9]{0,7}$/.test(raw)) throw new ImageStorageError("invalid_input");
  const bytes = Number(raw);
  const contentLength = request.headers.get("content-length");
  if (bytes > MAX_IMAGE_BYTES || (contentLength !== null && Number(contentLength) !== bytes))
    throw new ImageStorageError("invalid_output");
  return bytes;
};

/** Owner-ingest admission, not another native/provider-envelope reservation. */
export class ChatGeneratedMemory {
  private readonly scope: string;
  constructor(scope: string) {
    this.scope = scope;
  }
  private key(key: ImageCallKey): string {
    return JSON.stringify([this.scope, key.chatId, key.callId]);
  }
  private close(id: string, entry: HeldCall): void {
    entry.closing = true;
    entry.lease.releaseWhenSettled();
    if (entry.pending === 0 && calls.get(id) === entry) calls.delete(id);
  }
  private acquire(key: ImageCallKey, capacity: number): { entry: HeldCall; fresh: boolean } {
    const id = this.key(key);
    const existing = calls.get(id);
    if (existing !== undefined) {
      if (existing.capacity !== capacity) throw new ImageStorageError("conflict");
      if (existing.closing) throw new ImageStorageError("unavailable");
      return { entry: existing, fresh: false };
    }
    if (!Number.isSafeInteger(capacity) || capacity <= 0 || capacity > RETAINED_BYTES_PER_USER)
      throw new ImageStorageError("invalid_input");
    const originals: { kind: "image"; byteSize: number }[] = [];
    for (let remaining = capacity; remaining > 0; remaining -= MAX_IMAGE_BYTES)
      originals.push({ kind: "image", byteSize: Math.min(remaining, MAX_IMAGE_BYTES) });
    const lease = tryReserveImageMemory({ purpose: "original", originals });
    if (lease === null) throw new ImageStorageError("unavailable");
    const entry: HeldCall = { lease, capacity, pending: 0, closing: false };
    calls.set(id, entry);
    return { entry, fresh: true };
  }
  /** Capacity exists before synchronous SQL admission can return permission to spend. */
  admit<T>(key: ImageCallKey, capacity: number, work: () => T): T {
    const held = this.acquire(key, capacity);
    try {
      return work();
    } catch (error) {
      if (held.fresh) this.close(this.key(key), held.entry);
      throw error;
    }
  }
  run<T>(key: ImageCallKey, capacity: number, bytes: number, work: () => Promise<T>): Promise<T> {
    const held = this.acquire(key, capacity);
    const id = this.key(key);
    try {
      held.entry.lease.claim("original", bytes);
    } catch {
      if (held.fresh) this.close(id, held.entry);
      throw new ImageStorageError("unavailable");
    }
    held.entry.pending += 1;
    return held.entry.lease.track(work).finally(() => {
      held.entry.pending -= 1;
      if (held.entry.closing && held.entry.pending === 0 && calls.get(id) === held.entry)
        calls.delete(id);
    });
  }
  finish(key: ImageCallKey): void {
    const id = this.key(key);
    const entry = calls.get(id);
    if (entry !== undefined) this.close(id, entry);
  }
}
