import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { mintImageLease } from "./chat-file-budgets";
import { useImageBudget } from "./chat-image-budget";
import type { PreviewFile, PreviewLease } from "./chat-file-preview-types";

export type PreviewReservation = {
  /** Index derived from the immutable selected identity, or null when gone. */
  index: number | null;
  /** False when the shared tab budget (or unavailable dimensions) withheld it. */
  allowed: boolean;
  /** Honest reason shown when a preview is withheld. */
  withheldReason: string | null;
  /** Lease the opened content pins while its native load/decode runs. */
  lease: PreviewLease | null;
  select: (index: number) => void;
  close: () => void;
};

const BUDGET_FULL =
  "Preview withheld: the tab preview budget is full. Close another preview first.";
const DIMENSIONS_UNKNOWN =
  "Preview withheld: this image's dimensions are unavailable, so its decode cannot be bounded.";

type Primary = {
  /** id + current source + reservation key: a changed file is a new identity. */
  identity: string;
  allowed: boolean;
  withheldReason: string | null;
  lease: PreviewLease | null;
  /** A vanished identity is revoked permanently and can never revive. */
  revoked: boolean;
};

const identityOf = (file: PreviewFile): string =>
  `${file.id}|${file.url ?? ""}|${file.reservationKey ?? ""}`;

/**
 * Owns one inspector's primary lease in the shared tab preview budget.
 *
 * Selection is an immutable identity, never a bare index. A vanished identity
 * is revoked during render before commit, and its captured record is released
 * at layout time; releases always target that exact record, so a stale
 * invalidation can never touch a later selection, even on a borrowed key.
 * Pending pins still finalize in their own load/decode closures.
 */
export function usePreviewReservation(files: readonly PreviewFile[]): PreviewReservation {
  const budget = useImageBudget();
  const [primary, setPrimary] = useState<Primary | null>(null);
  const selectedRef = useRef<Primary | null>(null);
  // Each retained lease object is released at most once, whichever record copy
  // references it, so revocation and a racing select can never double-release.
  const retired = useRef(new WeakSet<PreviewLease>());

  const retire = useCallback(
    (record: Primary | null) => {
      const lease = record?.lease;
      if (!lease || retired.current.has(lease)) return;
      retired.current.add(lease);
      budget.release(lease.key);
    },
    [budget],
  );

  // Valid props/state adjustment: revoke a vanished selection before it commits,
  // so no passive effect can later release a newer selection's lease.
  if (primary && !primary.revoked && !files.some((file) => identityOf(file) === primary.identity)) {
    setPrimary({ ...primary, revoked: true });
  }

  useLayoutEffect(() => {
    // Release exactly the captured revoked record; idempotent via the WeakSet.
    if (primary?.revoked) retire(primary);
  }, [primary, retire]);

  useEffect(() => () => retire(selectedRef.current), [retire]);

  const select = useCallback(
    (index: number) => {
      retire(selectedRef.current);
      const file = files[index];
      if (!file) {
        selectedRef.current = null;
        setPrimary(null);
        return;
      }
      let allowed = true;
      let withheldReason: string | null = null;
      let lease: PreviewLease | null = null;
      const decodedBytes =
        file.width !== null && file.height !== null ? file.width * file.height * 4 : null;
      if (file.kind === "text") {
        const key = mintImageLease(`inspect:${file.id}`);
        allowed = budget.retain(key, 0, file.byteSize);
        if (allowed) lease = { key, decodedBytes: 0, previewBytes: file.byteSize };
        else withheldReason = BUDGET_FULL;
      } else if (file.url !== null) {
        if (decodedBytes === null) {
          allowed = false;
          withheldReason = DIMENSIONS_UNKNOWN;
        } else {
          // A staged thumbnail's lease is reused and borrowed here; the inspector
          // holds its own retain, so refcounts keep both owners accounted.
          const key = file.reservationKey ?? mintImageLease(`inspect:${file.id}`);
          allowed = budget.retain(key, decodedBytes, file.byteSize);
          if (allowed) lease = { key, decodedBytes, previewBytes: file.byteSize };
          else withheldReason = BUDGET_FULL;
        }
      }
      const record: Primary = {
        identity: identityOf(file),
        allowed,
        withheldReason,
        lease,
        revoked: false,
      };
      selectedRef.current = record;
      setPrimary(record);
    },
    [budget, files, retire],
  );

  const close = useCallback(() => {
    retire(selectedRef.current);
    selectedRef.current = null;
    setPrimary(null);
  }, [retire]);

  const exists =
    primary !== null &&
    !primary.revoked &&
    files.some((file) => identityOf(file) === primary.identity);
  const active = exists ? primary : null;
  const resolved = active ? files.findIndex((file) => identityOf(file) === active.identity) : -1;
  return {
    index: resolved >= 0 ? resolved : null,
    allowed: active?.allowed ?? true,
    withheldReason: active?.withheldReason ?? null,
    lease: active?.lease ?? null,
    select,
    close,
  };
}
