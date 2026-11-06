/** Attempt identity fences asynchronous preview preparation and object URL cleanup. */
export type AttemptLease = { rowId: string };
export function createImageAttemptOwner() {
  const current = new Map<string, AttemptLease>();
  return {
    begin(rowId: string): AttemptLease {
      const lease = { rowId };
      current.set(rowId, lease);
      return lease;
    },
    fenced: (lease: AttemptLease): boolean => current.get(lease.rowId) === lease,
    discard(lease: AttemptLease, previewUrl: string | null): void {
      if (current.get(lease.rowId) === lease) current.delete(lease.rowId);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    releaseRow(rowId: string): void {
      current.delete(rowId);
    },
  };
}
