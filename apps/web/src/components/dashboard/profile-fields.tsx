/**
 * The three Profile fields plus the saved-only AI disclosure.
 *
 * Field errors are described inline with `aria-invalid` and a linked message, the
 * sign-in email is plain non-editable metadata, and the About me counter is
 * derived from the real value. During publication the inputs become read-only —
 * visually unchanged, but a late edit can no longer be lost to the response.
 */
import { aboutCount } from "@/lib/account-validate";
import type { ProfileDraft } from "./profile-draft";

type Props = {
  readonly draft: ProfileDraft;
  readonly email: string;
  readonly showErrors: boolean;
  readonly nameProblem: string | null;
  readonly aboutProblem: string | null;
  readonly frozen: boolean;
  readonly onChange: (next: Partial<ProfileDraft>) => void;
  readonly onBlurName: () => void;
};

export default function ProfileFields({
  draft,
  email,
  showErrors,
  nameProblem,
  aboutProblem,
  frozen,
  onChange,
  onBlurName,
}: Props) {
  const nameShown = showErrors && nameProblem !== null;
  const aboutShown = showErrors && aboutProblem !== null;
  return (
    <>
      <div data-cx="profile-field">
        <label data-cx="profile-label" htmlFor="profile-name">
          Display name
        </label>
        <input
          id="profile-name"
          data-cx="profile-input"
          value={draft.displayName}
          maxLength={80}
          readOnly={frozen}
          aria-invalid={nameShown}
          aria-describedby="profile-name-help"
          onChange={(event) => onChange({ displayName: event.target.value })}
          onBlur={onBlurName}
        />
        {nameShown ? (
          <p id="profile-name-help" data-cx="profile-error" role="alert">
            {nameProblem}
          </p>
        ) : (
          <p id="profile-name-help" data-cx="profile-hint">
            Shown around the dashboard · 1–80 characters
          </p>
        )}
      </div>
      <div data-cx="profile-field">
        <span data-cx="profile-label" id="profile-email-label">
          Sign-in email
        </span>
        <p data-cx="profile-email" aria-labelledby="profile-email-label">
          {email}
        </p>
        <p data-cx="profile-hint">Used to sign in. Cannot be changed here.</p>
      </div>
      <div data-cx="profile-field">
        <label data-cx="profile-label" htmlFor="profile-about">
          About me <span>(optional)</span>
        </label>
        <textarea
          id="profile-about"
          data-cx="profile-input"
          value={draft.aboutMe}
          maxLength={500}
          readOnly={frozen}
          aria-invalid={aboutShown}
          aria-describedby="profile-about-help profile-about-count"
          onChange={(event) => onChange({ aboutMe: event.target.value })}
        />
        <span id="profile-about-count" data-cx="profile-count">
          {aboutCount(draft.aboutMe)}
        </span>
        {aboutShown ? (
          <p id="profile-about-help" data-cx="profile-error" role="alert">
            {aboutProblem}
          </p>
        ) : (
          <p id="profile-about-help" data-cx="profile-hint">
            A little context to help AI understand you.
          </p>
        )}
      </div>
    </>
  );
}
