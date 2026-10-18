import "./error-notice.css";

type Action = { label: string; onClick: () => void; disabled?: boolean };

/** Presentation only: recovery and dismissal stay with the source owner. */
export default function ErrorNotice({
  title,
  message,
  action,
  onDismiss,
  dismissLabel = "Dismiss error",
}: {
  title: string;
  message: string;
  action?: Action;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  return (
    <section data-cx="error-notice" role="alert" aria-atomic="true">
      <svg
        data-cx="error-notice-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4m0 4h.01" />
      </svg>
      <div data-cx="error-notice-content">
        <strong>{title}</strong>
        <p>{message}</p>
        {action && (
          <button
            type="button"
            data-cx="error-notice-action"
            disabled={action.disabled}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          data-cx="error-notice-dismiss"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          ×
        </button>
      )}
    </section>
  );
}
