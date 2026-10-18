/** Revision-pinned drafts; reviews cannot undo a newer read or publication. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, getProfile, writeProfile, type ProfileView } from "@/lib/account-api";
import { ChatApiError } from "@/lib/chat-api";
import { FEEDBACK } from "./profile-copy";
import { useAccountProfile } from "./profile-context";
import {
  aboutError,
  canSave,
  draftFromProfile,
  isDirty,
  nameError,
  toWriteInput,
  type ProfileDraft,
} from "./profile-draft";
import { usePhotoDraft } from "./use-photo-draft";

export function useProfileForm() {
  const { saved, applySaved, reload, status, error } = useAccountProfile();
  const [baseState, setBase] = useState<ProfileView | null>(null);
  const [draftState, setDraft] = useState<ProfileDraft | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState(false);
  const [transient, setTransient] = useState<"saving" | "saved" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const savingRef = useRef(false);
  const reviewGeneration = useRef(0);
  const baseRevision = useRef(-1);
  useEffect(
    () => () => {
      reviewGeneration.current += 1;
    },
    [],
  );
  const adoptBase = useCallback((profile: ProfileView): boolean => {
    if (profile.revision < baseRevision.current) return false;
    baseRevision.current = profile.revision;
    setBase(profile);
    return true;
  }, []);

  const base = baseState ?? saved;
  const seeded = useMemo(() => (base === null ? null : draftFromProfile(base)), [base]);
  const draft = draftState ?? seeded;

  const patch = useCallback(
    (next: Partial<ProfileDraft>) => {
      setDraft((value) => {
        const current = value ?? seeded;
        return current === null ? value : { ...current, ...next };
      });
    },
    [seeded],
  );

  /** Edits never clear an in-flight publication; the fields stay frozen instead. */
  const accepted = useCallback(
    (next: Partial<ProfileDraft>) => {
      if (savingRef.current) return;
      if (base !== null) adoptBase(base);
      // A fresh edit invalidates a previous success message; the save guard lives
      // in `savingRef` and is never touched here.
      setTransient((value) => (value === "saved" ? null : value));
      setTouched(true);
      patch(next);
    },
    [adoptBase, base, patch],
  );

  const isPublishing = useCallback(() => savingRef.current, []);
  const photo = usePhotoDraft(draft?.photo, (next) => accepted({ photo: next }), isPublishing);

  /** Silent draft reset used when the user explicitly discards while leaving. */
  const discardDrafts = useCallback(() => {
    reviewGeneration.current += 1;
    photo.reset();
    setStale(false);
    setAttempted(false);
    setTouched(false);
    setDraft(base === null ? null : draftFromProfile(base));
  }, [base, photo]);

  const cancel = useCallback(() => {
    if (savingRef.current) return;
    reviewGeneration.current += 1;
    photo.reset();
    setNotice(null);
    setStale(false);
    setAttempted(false);
    setTouched(false);
    const latest =
      saved !== null && (base === null || saved.revision > base.revision) ? saved : base;
    if (latest !== null) adoptBase(latest);
    setDraft(latest === null ? null : draftFromProfile(latest));
  }, [adoptBase, base, photo, saved]);

  const save = useCallback(async () => {
    if (savingRef.current || base === null || draft === null) return;
    setAttempted(true);
    if (!canSave(base, draft, photo.upload, false)) return;
    savingRef.current = true;
    reviewGeneration.current += 1;
    setTransient("saving");
    setNotice(null);
    try {
      const profile = await writeProfile(toWriteInput(base, draft));
      const current = applySaved(profile);
      if (!adoptBase(profile)) {
        setStale(true);
        setTransient(null);
        return;
      }
      photo.reset();
      setStale(!current);
      setAttempted(false);
      setTouched(false);
      setDraft(draftFromProfile(profile));
      setTransient(current ? "saved" : null);
      if (!current)
        setNotice("Your changes were saved, but a newer profile is available. Review latest.");
    } catch (cause) {
      setTransient(null);
      if (cause instanceof ChatApiError && cause.status === 409) {
        setStale(true);
        return;
      }
      setNotice(`${FEEDBACK.saveFailed} ${errorMessage(cause)}`);
    } finally {
      savingRef.current = false;
    }
  }, [adoptBase, applySaved, base, draft, photo]);

  const reviewLatest = useCallback(async () => {
    if (savingRef.current) return;
    const token = ++reviewGeneration.current;
    try {
      const latest = await getProfile();
      if (token !== reviewGeneration.current || savingRef.current) return;
      if (latest.revision < baseRevision.current || !applySaved(latest)) return;
      adoptBase(latest);
      setStale(false);
      setNotice(null);
    } catch (cause) {
      if (token !== reviewGeneration.current || savingRef.current) return;
      setNotice(errorMessage(cause));
      reload();
    }
  }, [adoptBase, applySaved, reload]);

  const dirty = base !== null && draft !== null && isDirty(base, draft);
  const saving = transient === "saving";

  return {
    base,
    draft,
    upload: photo.upload,
    transient,
    notice,
    stale: stale || (base !== null && saved !== null && saved.revision > base.revision),
    showErrors: attempted || touched,
    dirty,
    uploading: photo.upload.state === "uploading",
    saving,
    busy: photo.upload.state === "uploading" || saving,
    loadStatus: status,
    loadError: error,
    retryLoad: reload,
    nameProblem: draft === null ? null : nameError(draft.displayName),
    aboutProblem: draft === null ? null : aboutError(draft.aboutMe),
    saveDisabled: base === null || draft === null || !canSave(base, draft, photo.upload, saving),
    cancelDisabled: !dirty || saving,
    change: accepted,
    setShowErrors: setAttempted,
    save,
    cancel,
    discardDrafts,
    choosePhoto: photo.choosePhoto,
    removePhoto: photo.removePhoto,
    discardPhotoChange: photo.discardPhotoChange,
    retryUpload: photo.retryUpload,
    reviewLatest,
  };
}

export type ProfileFormState = ReturnType<typeof useProfileForm>;
