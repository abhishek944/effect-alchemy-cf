import AuthForm, { type AuthMode } from "./auth-form";

type Props = {
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  checking: boolean;
  sessionError: string | null;
};

export default function AuthPanel({ mode, onModeChange, checking, sessionError }: Props) {
  const signup = mode === "sign-up";
  return (
    <section className="account" id="account" aria-labelledby="account-title" tabIndex={-1}>
      <p className="eyebrow">{signup ? "CREATE YOUR ACCOUNT" : "WELCOME BACK"}</p>
      <h2 id="account-title">{signup ? "Make room." : "Welcome back."}</h2>
      <p className="account-intro">
        {signup
          ? "Create an account with your email and password."
          : "Sign in with your email and password."}
      </p>
      {checking && (
        <output className="session-status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          Checking your session…
        </output>
      )}
      {/* Session refetches must not discard the form result or entered values. */}
      <div hidden={checking}>
        {sessionError && (
          <p className="feedback" role="alert">
            Unable to check your session. Please try again.
          </p>
        )}
        <AuthForm key={mode} mode={mode} onModeChange={onModeChange} />
      </div>
    </section>
  );
}
