/**
 * Bounded ownership of frame operations.
 *
 * A claim covers the whole outstanding lifetime of a request, queued or running, so a
 * duplicate that arrives while its original still waits in the serial queue stays unowned.
 * Settled ids live in a short ring that absorbs late replays. Exceeding the outstanding
 * bound refuses explicitly instead of waiting forever, and no lifetime action budget exists:
 * a long-lived editor must never start refusing work because of its history.
 */
export type FrameClaim = "accepted" | "duplicate" | "busy";

export function frameOwnership(outstandingLimit = 32, settledLimit = 32) {
  const outstanding = new Set<string>();
  const settled: string[] = [];
  return {
    /** Claims one request id for execution; duplicates and stale replays stay unowned. */
    claim(id: string): FrameClaim {
      if (outstanding.has(id) || settled.includes(id)) return "duplicate";
      if (outstanding.size >= outstandingLimit) return "busy";
      outstanding.add(id);
      return "accepted";
    },
    /** Releases the claim after the response was sent or the request failed. */
    settle(id: string) {
      if (!outstanding.delete(id)) return;
      settled.push(id);
      if (settled.length > settledLimit) settled.shift();
    },
  };
}
