const PENDING_RETURN =
  "If you just returned from checkout, confirmation may still be pending. Refresh to see the latest status.";

type BillingReturnNoticeProps = {
  busy: string | null;
  onRefresh: () => void;
};

/** Polite post-checkout notice; the URL parameter never grants access. */
export default function BillingReturnNotice({ busy, onRefresh }: BillingReturnNoticeProps) {
  return (
    <output data-cx="billing-notice">
      <span>{PENDING_RETURN}</span>
      <button
        type="button"
        data-cx="billing-button"
        aria-busy={busy === "reload"}
        disabled={busy !== null}
        onClick={onRefresh}
      >
        Refresh
      </button>
    </output>
  );
}
