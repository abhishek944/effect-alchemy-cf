import type { ChatSnapshot } from "./chat-model.ts";
import { RefreshFence } from "./chat-contract.ts";

/** A stream is closed this often so the browser revalidates auth on reconnect. */
const SSE_MAX_MS = 5 * 60_000;
const SSE_RETRY_MS = 3000;
/** One encoded frame above this closes the stream; refresh recovery follows. */
const MAX_FRAME_BYTES = 128 * 1024;
/** Queue budget: one allowed frame plus one coalesced pending frame. */
const MAX_QUEUED_BYTES = MAX_FRAME_BYTES * 2;

export type SnapshotSource = {
  /** Current bounded window plus at most one live row. */
  readonly current: () => Promise<ChatSnapshot>;
  /** Commit invalidation; the callback must be tiny and must not call Pi APIs. */
  readonly subscribe: (invalidate: () => void) => () => void;
};

/**
 * Snapshot-first SSE relay driven by native commit invalidation instead of a
 * full event mount. Coalesces to one dirty flag, keeps at most one queued and
 * one pending encoded frame, and closes slow or oversized streams so the
 * browser reconnects and rebuilds from an authoritative bounded snapshot.
 */
export const streamChat = (source: SnapshotSource, signal: AbortSignal): Response => {
  const encoder = new TextEncoder();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  let out: ReadableStreamDefaultController<Uint8Array> | null = null;
  let deadline: ReturnType<typeof setTimeout> | null = null;
  let queuedBytes = 0;
  let pending: Uint8Array | null = null;
  let draining = false;
  let scheduled = false;
  let dirty = true;
  let previous = "";

  const close = async () => {
    if (closed) return;
    closed = true;
    pending = null;
    previous = "";
    if (deadline !== null) clearTimeout(deadline);
    deadline = null;
    signal.removeEventListener("abort", onAbort);
    const stop = unsubscribe;
    unsubscribe = null;
    stop?.();
    try {
      out?.close();
    } catch {
      // Already closed by the runtime.
    }
  };
  const onAbort = () => void close();

  const enqueue = (frame: Uint8Array): boolean => {
    if (frame.byteLength > MAX_FRAME_BYTES) return false;
    if (queuedBytes > 0) {
      pending = frame;
      return true;
    }
    if (queuedBytes + frame.byteLength > MAX_QUEUED_BYTES) return false;
    out?.enqueue(frame);
    queuedBytes += frame.byteLength;
    return true;
  };

  const flushPending = () => {
    queuedBytes = 0;
    const frame = pending;
    pending = null;
    if (frame !== null && !enqueue(frame)) void close();
  };

  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      let retries = 0;
      while (dirty) {
        if (closed) return;
        if (retries++ >= 4) {
          await close();
          return;
        }
        dirty = false;
        let snapshot: ChatSnapshot;
        try {
          snapshot = await source.current();
        } catch (error) {
          if (error instanceof RefreshFence && dirty) continue;
          throw error;
        }
        if (closed) return;
        const data = JSON.stringify(snapshot);
        if (data === previous) continue;
        previous = data;
        if (!enqueue(encoder.encode(`event: snapshot\ndata: ${data}\n\n`))) {
          await close();
          return;
        }
      }
    } catch {
      await close();
    } finally {
      draining = false;
    }
  };

  const schedule = () => {
    dirty = true;
    if (scheduled || draining || closed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!closed) void drain();
    });
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      out = controller;
      signal.addEventListener("abort", onAbort, { once: true });
      deadline = setTimeout(() => void close(), SSE_MAX_MS);
      controller.enqueue(encoder.encode(`retry: ${SSE_RETRY_MS}\n\n`));
      // Subscribe before the first read so no commit is missed between them.
      unsubscribe = source.subscribe(schedule);
      if (signal.aborted) void close();
      else schedule();
    },
    pull() {
      flushPending();
    },
    cancel() {
      void close();
      return undefined;
    },
  });

  return new Response(body, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
};
