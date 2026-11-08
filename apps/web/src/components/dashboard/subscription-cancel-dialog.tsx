import { useCallback, useEffect, useRef, type KeyboardEvent, type RefObject } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  returnFocus?: RefObject<HTMLElement | null>;
};

/**
 * Centered cancellation preview.
 *
 * Native modal `<dialog>` owns the inert background and top layer. Confirmation
 * stays disabled because no billing source can authorize or time a cancellation.
 */
export default function SubscriptionCancelDialog({ open, onClose, returnFocus }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return undefined;
    const cancel = (event: Event) => {
      event.preventDefault();
      dialog.close();
    };
    const close = () => {
      onClose();
      const opener = returnFocus?.current ?? openerRef.current;
      openerRef.current = null;
      window.requestAnimationFrame(() => {
        if (opener?.isConnected) opener.focus();
      });
    };
    dialog.addEventListener("cancel", cancel);
    dialog.addEventListener("close", close);
    return () => {
      dialog.removeEventListener("cancel", cancel);
      dialog.removeEventListener("close", close);
    };
  }, [onClose, returnFocus]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (open) {
      if (!dialog.open) {
        openerRef.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        dialog.showModal();
      }
      keepRef.current?.focus();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [open]);

  const trapTab = useCallback((event: KeyboardEvent<HTMLDialogElement>) => {
    if (event.key !== "Tab") return;
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    );
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }, []);

  return (
    <dialog
      ref={dialogRef}
      data-cx="subscription-dialog"
      aria-labelledby="subscription-cancel-title"
      aria-describedby="subscription-cancel-description"
      onKeyDown={trapTab}
    >
      <h2 id="subscription-cancel-title">Cancel subscription?</h2>
      <p id="subscription-cancel-description">
        This is an illustrative preview. No billing source is connected, so a cancellation cannot be
        requested, scheduled or confirmed.
      </p>
      <dl data-cx="subscription-dialog-facts">
        <div>
          <dt>Timing</dt>
          <dd>Not available</dd>
        </div>
        <div>
          <dt>Effective date</dt>
          <dd>Not available</dd>
        </div>
      </dl>
      <p data-cx="subscription-dialog-note">
        Plan status and cancellation policy require a billing source.
      </p>
      <div data-cx="subscription-dialog-actions">
        <button ref={keepRef} type="button" onClick={() => dialogRef.current?.close()}>
          Keep subscription
        </button>
        <button
          type="button"
          data-variant="danger"
          disabled
          aria-describedby="subscription-confirm-note"
        >
          Confirm cancellation
        </button>
      </div>
      <p id="subscription-confirm-note" data-cx="subscription-dialog-note">
        Confirmation is unavailable in this preview.
      </p>
    </dialog>
  );
}
