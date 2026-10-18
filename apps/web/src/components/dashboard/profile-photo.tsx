/**
 * Private photo control for the Profile form.
 *
 * The borderless pencil is always visible at the selected geometry and is the only way
 * to choose, replace or remove a photo. A selected photo previews immediately and
 * belongs to the draft, so a pending or failed upload is already an unsaved change.
 */
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "./icon";
import { observeMenuOutside } from "./profile-menu-outside";
import {
  avatarInstructionLabel,
  draftPreviewUrl,
  photoCaption,
  type PhotoDraft,
  type UploadState,
} from "./profile-draft";
import type { ProfileView } from "@/lib/account-api";

type Props = {
  readonly saved: ProfileView | null;
  readonly photo: PhotoDraft;
  readonly upload: UploadState;
  readonly initials: string;
  readonly savedPhotoUrl: string | null;
  readonly busy: boolean;
  readonly frozen: boolean;
  readonly onChoose: (file: File) => void;
  readonly onRemove: () => void;
  readonly onRetry: () => void;
  readonly onDiscardPhoto: () => void;
};

const ACCEPT = "image/jpeg,image/png,image/webp";

export default function ProfilePhoto({
  saved,
  photo,
  upload,
  initials,
  savedPhotoUrl,
  busy,
  frozen,
  onChoose,
  onRemove,
  onRetry,
  onDiscardPhoto,
}: Props) {
  const menuId = useId();
  const restoreFocusRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /**
   * Event-owned request. Visibility is derived (`open`), so a publication hides the
   * menu without any effect writing state and it cannot reappear when the
   * publication settles.
   */
  const [requested, setRequested] = useState(false);
  const open = requested && !frozen;

  const previewUrl = draftPreviewUrl(photo);
  const source = photo.kind === "remove" ? null : (previewUrl ?? savedPhotoUrl);
  const caption = photoCaption(photo, upload);
  const canRemove =
    photo.kind !== "remove" && (saved?.avatar.kind === "photo" || photo.kind !== "keep");
  const close = useCallback((restore: boolean) => {
    setRequested(false);
    if (restore) triggerRef.current?.focus();
  }, []);

  /** Moves focus to a real field when the menu closes while holding it. */
  const releaseFocus = useCallback(() => {
    const active = document.activeElement;
    if (!(active instanceof Node) || !menuRef.current?.contains(active)) return;
    // The field lives beside this wrapper, inside the profile root.
    const root = restoreFocusRef.current?.closest<HTMLElement>('[data-cx="profile"]') ?? null;
    const target =
      root?.querySelector<HTMLElement>("#profile-name") ?? root ?? restoreFocusRef.current ?? null;
    target?.focus();
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const first = menuRef.current?.querySelector<HTMLButtonElement>("button");
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close(true);
      }
      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
      const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
      if (items.length === 0) return;
      event.preventDefault();
      const active = document.activeElement;
      const index = active instanceof HTMLButtonElement ? items.indexOf(active) : -1;
      const next =
        event.key === "ArrowDown"
          ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener("keydown", onKey);
    const releaseOutside = observeMenuOutside({
      menu: menuRef,
      trigger: triggerRef,
      releaseFocus,
      close: () => setRequested(false),
    });
    return () => {
      document.removeEventListener("keydown", onKey);
      releaseOutside();
    };
  }, [open, close, releaseFocus]);

  return (
    <div ref={restoreFocusRef} data-cx="profile-photo">
      <div data-cx="profile-portrait">
        {source === null ? (
          <span data-cx="profile-initials" aria-hidden="true">
            {initials}
          </span>
        ) : (
          <img src={source} alt="" />
        )}
        <button
          ref={triggerRef}
          type="button"
          data-cx="profile-edit"
          aria-label="Edit profile photo"
          aria-expanded={open}
          aria-controls={menuId}
          disabled={busy || frozen}
          onClick={() => setRequested((value) => (frozen ? false : !value))}
        >
          <Icon name="pencil" />
        </button>
        {open ? (
          <div ref={menuRef} id={menuId} data-cx="profile-menu" aria-label="Photo actions">
            <button
              type="button"
              disabled={frozen}
              onClick={() => {
                if (frozen) return;
                inputRef.current?.click();
              }}
            >
              {saved === null ? "Choose photo…" : avatarInstructionLabel(saved)}
            </button>
            {canRemove ? (
              <button
                type="button"
                disabled={frozen}
                onClick={() => {
                  if (frozen) return;
                  close(false);
                  onRemove();
                }}
              >
                Remove photo
              </button>
            ) : null}
            <p>
              JPEG, PNG or WebP
              <br />
              Up to 5 MiB / 2 MP. No crop.
            </p>
          </div>
        ) : null}
      </div>
      <span data-cx="profile-caption">{caption}</span>
      {upload.state === "failed" ? (
        <div data-cx="profile-feedback" role="alert">
          <p data-cx="profile-error">Photo upload failed. Your draft is kept; nothing was saved.</p>
          <button type="button" data-cx="profile-btn" data-variant="ghost" onClick={onRetry}>
            Retry upload
          </button>
          <button type="button" data-cx="profile-btn" data-variant="ghost" onClick={onDiscardPhoto}>
            Discard photo change
          </button>
        </div>
      ) : null}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        disabled={busy || frozen}
        data-cx="profile-file"
        aria-label="Choose a profile photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          close(false);
          if (file) onChoose(file);
        }}
      />
    </div>
  );
}
