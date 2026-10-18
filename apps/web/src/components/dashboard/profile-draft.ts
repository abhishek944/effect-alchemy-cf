/**
 * Pure draft rules for the Profile form.
 *
 * Drafts are local until one explicit Save; the saved record stays authoritative
 * so validation, upload failure, a stale conflict or Cancel never publish a
 * partial change. Selecting a photo makes the draft dirty immediately (with its
 * own local preview URL), and a pending or failed photo blocks publication until
 * the upload succeeds or the user explicitly discards the photo change.
 */
import type { ProfileWriteInput, ProfileView } from "@/lib/account-api";

export const DISPLAY_NAME_MAX = 80;
export const ABOUT_ME_MAX = 500;

export type PhotoDraft =
  | { kind: "keep" }
  | { kind: "remove" }
  /** Selected and uploading or failed: dirty, previewed, never publishable. */
  | { kind: "pending"; previewUrl: string }
  | { kind: "uploaded"; avatarId: string; previewUrl: string };

export type ProfileDraft = {
  displayName: string;
  aboutMe: string;
  photo: PhotoDraft;
};

export type UploadState = { state: "idle" } | { state: "uploading" } | { state: "failed" };

export const draftFromProfile = (profile: ProfileView): ProfileDraft => ({
  displayName: profile.displayName,
  aboutMe: profile.aboutMe ?? "",
  photo: { kind: "keep" },
});

export const normalizeAboutMe = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

export const normalizeDisplayName = (value: string): string => value.trim();

/** Exact field error copy shown under the field; null when the draft is valid. */
export const nameError = (value: string): string | null => {
  const trimmed = normalizeDisplayName(value);
  return trimmed.length >= 1 && trimmed.length <= DISPLAY_NAME_MAX
    ? null
    : "Enter a display name (1–80 characters).";
};

export const aboutError = (value: string): string | null =>
  value.length <= ABOUT_ME_MAX ? null : "About me must be 500 characters or fewer.";

export const isDirty = (profile: ProfileView, draft: ProfileDraft): boolean =>
  normalizeDisplayName(draft.displayName) !== profile.displayName ||
  normalizeAboutMe(draft.aboutMe) !== profile.aboutMe ||
  draft.photo.kind !== "keep";

/** A photo is only publishable once it is uploaded, removed or deliberately kept. */
export const photoPublishable = (photo: PhotoDraft): boolean => photo.kind !== "pending";

export const canSave = (
  profile: ProfileView,
  draft: ProfileDraft,
  upload: UploadState,
  saving: boolean,
): boolean =>
  !saving &&
  isDirty(profile, draft) &&
  nameError(draft.displayName) === null &&
  aboutError(draft.aboutMe) === null &&
  upload.state === "idle" &&
  photoPublishable(draft.photo);

export const toWriteInput = (profile: ProfileView, draft: ProfileDraft): ProfileWriteInput => ({
  expectedRevision: profile.revision,
  displayName: normalizeDisplayName(draft.displayName),
  aboutMe: normalizeAboutMe(draft.aboutMe),
  avatar:
    draft.photo.kind === "keep"
      ? { kind: "keep" }
      : draft.photo.kind === "remove"
        ? { kind: "remove" }
        : draft.photo.kind === "uploaded"
          ? { kind: "publish", avatarId: draft.photo.avatarId }
          : // Unreachable while publication is guarded, kept total for safety.
            { kind: "keep" },
});

/** Footer status copy; one truthful line for the current form state. */
export const footerStatus = (
  profile: ProfileView,
  draft: ProfileDraft,
  transient: "saving" | "saved" | null,
): string => {
  if (transient === "saving") return "Saving…";
  // A dirty draft always wins: a previous success must never describe newer edits.
  if (isDirty(profile, draft)) return "Unsaved changes";
  if (transient === "saved") return "Profile saved.";
  return "All changes saved";
};

export const photoCaption = (photo: PhotoDraft, upload: UploadState): string => {
  if (photo.kind === "remove") return "Private profile photo";
  if (photo.kind === "pending" || photo.kind === "uploaded") {
    return upload.state === "uploading" ? "New photo · uploading…" : "New photo · not saved";
  }
  if (upload.state === "uploading") return "New photo · uploading…";
  if (upload.state === "failed") return "New photo · not saved";
  return "Private profile photo";
};

/** The local preview a draft owns, if any. */
export const draftPreviewUrl = (photo: PhotoDraft): string | null =>
  photo.kind === "pending" || photo.kind === "uploaded" ? photo.previewUrl : null;

export const avatarInstructionLabel = (profile: ProfileView): string =>
  profile.avatar.kind === "photo" ? "Replace photo…" : "Choose photo…";
