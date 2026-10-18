/**
 * Bounded account invalidation signal.
 *
 * The chat stream is the only place that knows a native run settled or that the
 * live connection was re-established. Instead of letting the theme provider guess
 * from assistant prose, the stream dispatches this one structured event and the
 * provider re-reads the authoritative account preference. No payload is executed
 * and no visible notice is produced.
 */
export const ACCOUNT_THEME_INVALIDATE = "effect-alchemy:account-theme-invalidate";

export type AccountInvalidationReason = "settled" | "reconnect";

export const invalidateAccountTheme = (reason: AccountInvalidationReason): void => {
  try {
    window.dispatchEvent(new CustomEvent(ACCOUNT_THEME_INVALIDATE, { detail: reason }));
  } catch {
    // A blocked event dispatch must never break the chat stream itself.
  }
};
