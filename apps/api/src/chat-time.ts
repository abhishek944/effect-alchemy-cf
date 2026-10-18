/** Corrupt/missing native time stays unavailable; never substitute today's time. */
export const storedMessageTime = (timestamp: number | undefined): string =>
  timestamp !== undefined && Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15
    ? new Date(timestamp).toISOString()
    : "";
