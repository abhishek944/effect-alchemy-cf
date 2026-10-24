/**
 * Bounded single-attempt IO primitives for native speech.
 *
 * The caller signal is forwarded into one owned controller; a timeout aborts
 * the same attempt instead of starting another. Response bodies are counted
 * while read and buffered only up to the caller's bound, so every attempt -
 * including a binary audio body - finishes inside the attempt lifetime and no
 * unread stream outlives its deadline, abort signal or error handling. Nothing
 * here logs or retains request or response data.
 */
export const SPEECH_TIMEOUT_MS = 60_000;

export type SpeechAttemptFailure = "timeout" | "network";

export type SpeechAttempt = {
  readonly signal: AbortSignal;
  readonly timedOut: () => boolean;
  readonly cancelled: () => boolean;
  readonly clear: () => void;
};

/** One owned controller: the caller signal forwards into it, a timeout aborts it. */
export const beginSpeechAttempt = (
  signal: AbortSignal | undefined,
  timeoutMs: number = SPEECH_TIMEOUT_MS,
): SpeechAttempt => {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const forward = () => {
    cancelled = true;
    controller.abort();
  };
  if (signal !== undefined) {
    if (signal.aborted) {
      cancelled = true;
      controller.abort();
    } else signal.addEventListener("abort", forward, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cancelled: () => cancelled,
    clear: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
};

/** Reads and discards a bounded provider error body without exposing it. */
export const drainResponse = async (response: Response): Promise<void> => {
  const body: ReadableStream<Uint8Array> | null = response.body;
  if (body === null) return;
  const reader = body.getReader();
  try {
    for (;;) {
      const { done } = await reader.read();
      if (done) return;
    }
  } finally {
    reader.releaseLock();
  }
};

export const readBoundedBytes = async (
  response: Response,
  limit: number,
): Promise<Uint8Array | null> => {
  const body: ReadableStream<Uint8Array> | null = response.body;
  if (body === null) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};
