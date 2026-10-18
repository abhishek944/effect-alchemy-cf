/**
 * Mount-lifetime and attempt-token ownership for staged image preparation.
 *
 * Every attempt keeps its own record and globally unique lease key until its
 * work actually finishes, so a superseded or unmounted attempt can never
 * install a preview, release another attempt's capacity, or leak an object
 * URL. Capacity stays charged while a read/decode is outstanding; a repeated
 * release request for pending work stays deferred, and each completion
 * releases only its own lease.
 */
import { documentImageBudget, mintImageLease, type ImageBudget } from "./chat-file-budgets";

type Attempt = {
  key: string;
  rowId: string;
  reservation: string | null;
  settled: boolean;
  abandoned: boolean;
};

export type AttemptLease = { key: string; rowId: string };

export type ImageAttemptOwner = {
  begin: (rowId: string) => AttemptLease;
  fenced: (lease: AttemptLease) => boolean;
  reserve: (lease: AttemptLease, decodedBytes: number, previewBytes: number) => boolean;
  reservedKey: (lease: AttemptLease) => string | null;
  settle: (lease: AttemptLease) => void;
  fail: (lease: AttemptLease) => void;
  discard: (lease: AttemptLease, previewUrl: string | null) => void;
  releaseRow: (rowId: string) => "deferred" | "released" | "none";
};

export function createImageAttemptOwner(
  budget: ImageBudget = documentImageBudget,
): ImageAttemptOwner {
  const leases = new Map<string, Attempt>();
  const currentByRow = new Map<string, string>();

  const own = (lease: AttemptLease): Attempt | null => {
    const attempt = leases.get(lease.key);
    return attempt && attempt.rowId === lease.rowId ? attempt : null;
  };
  const releaseLease = (attempt: Attempt) => {
    if (attempt.reservation) budget.release(attempt.reservation);
    attempt.reservation = null;
    leases.delete(attempt.key);
    if (currentByRow.get(attempt.rowId) === attempt.key) currentByRow.delete(attempt.rowId);
  };

  return {
    begin: (rowId) => {
      const key = mintImageLease(`attempt:${rowId}`);
      leases.set(key, { key, rowId, reservation: null, settled: false, abandoned: false });
      currentByRow.set(rowId, key);
      return { key, rowId };
    },
    fenced: (lease) => {
      const attempt = own(lease);
      return Boolean(attempt && !attempt.abandoned && currentByRow.get(lease.rowId) === lease.key);
    },
    reserve: (lease, decodedBytes, previewBytes) => {
      const attempt = own(lease);
      if (!attempt || attempt.abandoned || currentByRow.get(lease.rowId) !== lease.key)
        return false;
      if (!budget.retain(lease.key, decodedBytes, previewBytes)) return false;
      attempt.reservation = lease.key;
      return true;
    },
    reservedKey: (lease) => own(lease)?.reservation ?? null,
    settle: (lease) => {
      const attempt = own(lease);
      if (attempt) attempt.settled = true;
    },
    fail: (lease) => {
      const attempt = own(lease);
      if (attempt) releaseLease(attempt);
    },
    discard: (lease, previewUrl) => {
      const attempt = own(lease);
      if (attempt) releaseLease(attempt);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    releaseRow: (rowId) => {
      const key = currentByRow.get(rowId);
      if (!key) return "none";
      const attempt = leases.get(key);
      if (!attempt) {
        currentByRow.delete(rowId);
        return "none";
      }
      if (!attempt.settled) {
        // Pending work keeps its lease until it ends; repeat calls stay deferred.
        attempt.abandoned = true;
        return "deferred";
      }
      releaseLease(attempt);
      return "released";
    },
  };
}
