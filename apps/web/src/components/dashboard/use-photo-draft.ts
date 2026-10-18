/**
 * Photo draft, local preview and upload lifetime.
 *
 * Selecting a file marks the draft dirty immediately and installs a preview the
 * hook owns; the upload is then fenced by a generation token so a late response
 * can never revive a cancelled, replaced or unmounted draft. An obsolete success
 * cancels the stage it received, a failed upload leaves the draft blocked and
 * previewed, and every owned object URL is revoked exactly once.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { cancelAvatar, uploadAvatar } from "@/lib/account-api";
import type { PhotoDraft, UploadState } from "./profile-draft";

export function usePhotoDraft(
  photo: PhotoDraft | undefined,
  onPhoto: (next: PhotoDraft) => void,
  /**
   * Reads the latest publication state; stable for the hook's lifetime so an
   * unmount cleanup always sees the current value, never a mount-time snapshot.
   */
  isPublishing: () => boolean,
) {
  const [upload, setUpload] = useState<UploadState>({ state: "idle" });
  const generation = useRef(0);
  const ownedUrl = useRef<string | null>(null);
  const lastFile = useRef<File | null>(null);
  /** The unsaved stage this hook currently owns, if any. */
  const staged = useRef<string | null>(null);
  const mounted = useRef(true);

  const releasePreview = useCallback(() => {
    if (ownedUrl.current !== null) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = null;
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      // Unmount is a lifetime boundary like Cancel: the in-flight upload loses its
      // generation, and a known unsaved stage is cancelled. An already published
      // avatar is refused by the server's own state check, so this cannot delete
      // the saved photo; the durable sweep remains the fallback.
      mounted.current = false;
      generation.current += 1;
      releasePreview();
      const orphan = staged.current;
      staged.current = null;
      if (orphan !== null && !isPublishing()) void cancelAvatar(orphan);
    };
  }, [isPublishing, releasePreview]);

  // Track the unsaved stage of the current draft without cancelling a published one.
  useEffect(() => {
    staged.current = photo?.kind === "uploaded" ? photo.avatarId : null;
  }, [photo]);

  /** Invalidates any in-flight upload and drops the current draft photo. */
  const reset = useCallback(() => {
    generation.current += 1;
    if (photo?.kind === "uploaded" && !isPublishing()) void cancelAvatar(photo.avatarId);
    staged.current = null;
    releasePreview();
    lastFile.current = null;
    setUpload({ state: "idle" });
  }, [isPublishing, photo, releasePreview]);

  const runUpload = useCallback(
    async (file: File, token: number, previewUrl: string) => {
      if (!mounted.current) return;
      setUpload({ state: "uploading" });
      try {
        const avatar = await uploadAvatar(file, file.name);
        if (token !== generation.current) {
          // Obsolete completion: never install it, and never keep its stage.
          void cancelAvatar(avatar.avatarId);
          return;
        }
        staged.current = avatar.avatarId;
        onPhoto({ kind: "uploaded", avatarId: avatar.avatarId, previewUrl });
        if (mounted.current) setUpload({ state: "idle" });
      } catch {
        if (token !== generation.current || !mounted.current) return;
        setUpload({ state: "failed" });
      }
    },
    [onPhoto],
  );

  const choosePhoto = useCallback(
    (file: File) => {
      if (isPublishing()) return;
      generation.current += 1;
      const token = generation.current;
      if (photo?.kind === "uploaded") void cancelAvatar(photo.avatarId);
      staged.current = null;
      releasePreview();
      const previewUrl = URL.createObjectURL(file);
      ownedUrl.current = previewUrl;
      lastFile.current = file;
      onPhoto({ kind: "pending", previewUrl });
      void runUpload(file, token, previewUrl);
    },
    [isPublishing, onPhoto, photo, releasePreview, runUpload],
  );

  const removePhoto = useCallback(() => {
    if (isPublishing()) return;
    generation.current += 1;
    if (photo?.kind === "uploaded") void cancelAvatar(photo.avatarId);
    staged.current = null;
    releasePreview();
    lastFile.current = null;
    setUpload({ state: "idle" });
    onPhoto({ kind: "remove" });
  }, [isPublishing, onPhoto, photo, releasePreview]);

  const discardPhotoChange = useCallback(() => {
    if (isPublishing()) return;
    reset();
    onPhoto({ kind: "keep" });
  }, [isPublishing, onPhoto, reset]);

  const retryUpload = useCallback(() => {
    if (isPublishing()) return;
    const file = lastFile.current;
    const previewUrl = ownedUrl.current;
    if (file === null || previewUrl === null) return;
    generation.current += 1;
    const token = generation.current;
    onPhoto({ kind: "pending", previewUrl });
    void runUpload(file, token, previewUrl);
  }, [isPublishing, onPhoto, runUpload]);

  return {
    upload,
    choosePhoto,
    removePhoto,
    discardPhotoChange,
    retryUpload,
    reset,
    resetUpload: () => setUpload({ state: "idle" }),
  };
}
