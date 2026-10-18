/**
 * The single leave dialog for a dirty or publishing Profile form.
 *
 * The dirty variant offers an explicit discard with a safe Keep editing default.
 * The publishing variant exists because a save that is already in flight cannot be
 * discarded: it says so plainly instead of promising the drafts will not be saved,
 * and it keeps Stay as the safe default.
 */
import { useEffect, useRef } from "react";
import { LEAVE } from "./profile-copy";

type DialogProps = {
  readonly publishing: boolean;
  readonly onDiscard: () => void;
  readonly onKeepEditing: () => void;
};

export default function UnsavedChangesDialog({
  publishing,
  onDiscard,
  onKeepEditing,
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onKeepEditing();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [
        ...(dialogRef.current?.querySelectorAll<HTMLElement>(
          "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
        ) ?? []),
      ];
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (first === undefined || last === undefined) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onKeepEditing]);

  return (
    <div data-cx="profile-dialog-backdrop">
      <section
        ref={dialogRef}
        data-cx="profile-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="profile-leave-title"
        aria-describedby="profile-leave-copy"
      >
        <h2 id="profile-leave-title">{publishing ? LEAVE.publishingTitle : LEAVE.dirtyTitle}</h2>
        <p id="profile-leave-copy">{publishing ? LEAVE.publishingCopy : LEAVE.dirtyCopy}</p>
        <div data-cx="profile-dialog-actions">
          {publishing ? null : (
            <button type="button" data-cx="profile-btn" onClick={onDiscard}>
              {LEAVE.dirtyDiscard}
            </button>
          )}
          <button
            ref={keepRef}
            type="button"
            data-cx="profile-btn"
            data-variant="primary"
            onClick={onKeepEditing}
          >
            {publishing ? LEAVE.publishingStay : LEAVE.dirtyKeep}
          </button>
        </div>
      </section>
    </div>
  );
}
