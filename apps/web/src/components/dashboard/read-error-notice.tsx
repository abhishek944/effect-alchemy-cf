import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import ErrorNotice from "./error-notice";

/** Dismissing a load failure must leave its safe read-recovery reachable. */
export default function ReadErrorNotice({
  title,
  message,
  actionLabel,
  onReload,
  focusTarget,
}: {
  title: string;
  message: string;
  actionLabel: string;
  onReload: () => void;
  focusTarget: RefObject<HTMLElement | null>;
}) {
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);
  const dismissed = dismissedMessage === message;
  const recover = () => {
    focusTarget.current?.focus();
    setDismissedMessage(null);
    onReload();
  };
  const recoveryRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (dismissed) recoveryRef.current?.focus();
  }, [dismissed]);
  if (dismissed) {
    return (
      <button ref={recoveryRef} type="button" data-cx="error-notice-action" onClick={recover}>
        {actionLabel}
      </button>
    );
  }
  return (
    <ErrorNotice
      title={title}
      message={message}
      action={{ label: actionLabel, onClick: recover }}
      dismissLabel={`Dismiss error: ${title}`}
      onDismiss={() => setDismissedMessage(message)}
    />
  );
}
