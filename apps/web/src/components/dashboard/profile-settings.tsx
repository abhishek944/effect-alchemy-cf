/**
 * Profile section composition.
 *
 * Layout, copy and control states come from the selected visual source: a quiet
 * 560px form with the private photo first, the always-visible borderless pencil,
 * plain read-only email, optional About me, the saved-only AI disclosure, and one
 * atomic Save/Cancel. Recovery states live beside the photo, under the field, or
 * in the footer, and a failed initial read shows a quiet failure with Retry
 * instead of an endless loading line.
 */
import { useEffect, useRef } from "react";
import { profilePhotoUrl } from "@/lib/account-api";
import { FEEDBACK } from "./profile-copy";
import { footerStatus } from "./profile-draft";
import ProfileFields from "./profile-fields";
import ProfilePhoto from "./profile-photo";
import { initialsOf } from "./profile-context";
import UnsavedChangesDialog from "./profile-leave-dialog";
import { useUnsavedGuard } from "./use-unsaved-guard";
import { useProfileForm, type ProfileFormState } from "./use-profile-form";
import "./profile.css";
import "./profile-form.css";
import "./profile-states.css";

/** Mounted only for the profile section, so the draft state exists only there. */
export default function ProfileSection({
  email,
  fallbackName,
}: {
  email: string;
  fallbackName: string;
}) {
  const state = useProfileForm();
  return <ProfileForm state={state} email={email} fallbackName={fallbackName} />;
}

function ProfileForm({
  state,
  email,
  fallbackName,
}: {
  state: ProfileFormState;
  email: string;
  fallbackName: string;
}) {
  const { base, draft } = state;
  const formRef = useRef<HTMLDivElement>(null);
  const guard = useUnsavedGuard(state.dirty, formRef);
  const cancelPending = guard.cancelPending;
  const wasSaving = useRef(false);

  // A publication settles while the user is still on the form: the deferred
  // navigation is dropped rather than completed, so nothing is auto-navigated
  // after a failed or uncertain save and the draft is preserved.
  useEffect(() => {
    if (wasSaving.current && !state.saving) cancelPending();
    wasSaving.current = state.saving;
  }, [state.saving, cancelPending]);

  if (base === null || draft === null) {
    if (state.loadStatus === "error") {
      return (
        <div data-cx="profile" data-state="load-error">
          <p data-cx="profile-error" role="alert">
            {FEEDBACK.loadFailed}
          </p>
          {state.loadError === null ? null : <p data-cx="profile-note">{state.loadError}</p>}
          <button type="button" data-cx="profile-btn" onClick={state.retryLoad}>
            Retry
          </button>
        </div>
      );
    }
    return (
      <div data-cx="profile" data-state="loading">
        <p data-cx="profile-hint">Loading your saved profile…</p>
      </div>
    );
  }

  const nameShown = draft.displayName.trim().length > 0 ? draft.displayName : fallbackName;

  return (
    <div
      ref={formRef}
      tabIndex={-1}
      data-cx="profile"
      data-state={
        state.upload.state === "failed"
          ? "photo-error"
          : state.stale
            ? "stale"
            : state.dirty
              ? "dirty"
              : "pristine"
      }
    >
      <ProfilePhoto
        saved={base}
        photo={draft.photo}
        upload={state.upload}
        initials={initialsOf(nameShown, email)}
        savedPhotoUrl={base.avatar.kind === "photo" ? profilePhotoUrl(base.avatar.avatarId) : null}
        busy={state.busy}
        frozen={state.saving}
        onChoose={state.choosePhoto}
        onRemove={state.removePhoto}
        onRetry={state.retryUpload}
        onDiscardPhoto={state.discardPhotoChange}
      />
      <header data-cx="profile-head">
        <h1 data-cx="profile-title">Profile</h1>
        <p data-cx="profile-subtitle">Manage your personal details.</p>
      </header>
      {state.stale ? (
        <div data-cx="profile-feedback" role="alert">
          <p data-cx="profile-error">{FEEDBACK.staleTitle}</p>
          <p data-cx="profile-note">{FEEDBACK.staleNote}</p>
          <button
            type="button"
            data-cx="profile-btn"
            disabled={state.saving}
            onClick={() => void state.reviewLatest()}
          >
            Review latest
          </button>
        </div>
      ) : null}
      <form
        data-cx="profile-form"
        aria-busy={state.busy}
        onSubmit={(event) => event.preventDefault()}
      >
        <div data-cx="profile-fields">
          <ProfileFields
            draft={draft}
            email={email}
            showErrors={state.showErrors}
            nameProblem={state.nameProblem}
            aboutProblem={state.aboutProblem}
            frozen={state.saving}
            onChange={state.change}
            onBlurName={() => state.nameProblem !== null && state.setShowErrors(true)}
          />
        </div>
        <div data-cx="profile-ai">
          <strong>Your profile and AI</strong>
          <br />
          Saved name and About me may be sent to AI when relevant. Previous profile results remain
          in chat history. Email and photo are not shared with AI.
        </div>
        <div data-cx="profile-footer">
          <output data-cx="profile-status">
            {state.notice ?? footerStatus(base, draft, state.transient)}
          </output>
          <button
            type="button"
            data-cx="profile-btn"
            data-variant="ghost"
            disabled={state.cancelDisabled}
            onClick={state.cancel}
          >
            Cancel
          </button>
          <button
            type="button"
            data-cx="profile-btn"
            data-variant="primary"
            disabled={state.saveDisabled}
            onClick={() => void state.save()}
          >
            {state.uploading ? "Uploading…" : state.saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
      {guard.pending !== null ? (
        <UnsavedChangesDialog
          // A save already in flight cannot be discarded, so the dialog explains
          // that instead of promising the drafts will not be saved, and it never
          // resets or cancels the stage being published.
          publishing={state.saving}
          onDiscard={() => guard.discard(state.saving ? null : state.discardDrafts)}
          onKeepEditing={guard.keepEditing}
        />
      ) : null}
    </div>
  );
}
