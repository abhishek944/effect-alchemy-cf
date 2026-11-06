import { type FormEvent, useState } from "react";
import AuthFields from "./auth-fields";
import { PUBLIC_SITE_NAME } from "./public/public-brand";
import { authClient } from "@/lib/auth-client";

export type AuthMode = "sign-in" | "sign-up";
type Props = { mode: AuthMode; onModeChange: (mode: AuthMode) => void };

export default function AuthForm({ mode, onModeChange }: Props) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSigningUp = mode === "sign-up";
  const failureMessage = isSigningUp
    ? "Unable to create your account. Please try again."
    : "Unable to sign in. Please try again.";

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFeedback(null);
    setNotice(null);
    setPending(true);
    const values = new FormData(event.currentTarget);
    const nameEntry = values.get("name");
    const emailEntry = values.get("email");
    const passwordEntry = values.get("password");
    const name = typeof nameEntry === "string" ? nameEntry.trim() : "";
    const email = typeof emailEntry === "string" ? emailEntry.trim() : "";
    const password = typeof passwordEntry === "string" ? passwordEntry : "";

    try {
      if (isSigningUp) {
        const { error } = await authClient.signUp.email({ name, email, password });
        if (error) setFeedback(failureMessage);
        else setNotice("Account created successfully.");
      } else {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) setFeedback(failureMessage);
      }
    } catch {
      setFeedback(failureMessage);
    } finally {
      setPending(false);
    }
  };

  const toggleMode = () => {
    const nextMode = isSigningUp ? "sign-in" : "sign-up";
    onModeChange(nextMode);
    setFeedback(null);
    setNotice(null);
  };

  return (
    <>
      {feedback && (
        <p className="feedback" role="alert">
          {feedback}
        </p>
      )}
      {notice && (
        <output className="success" aria-live="polite">
          {notice}
        </output>
      )}
      <form aria-busy={pending} onSubmit={(event) => void handleSubmit(event)}>
        <AuthFields mode={mode} pending={pending} />
        <button className="primary" type="submit" disabled={pending}>
          {pending
            ? isSigningUp
              ? "Creating account…"
              : "Signing in…"
            : isSigningUp
              ? "Create account"
              : "Sign in"}
          <span aria-hidden="true">{pending ? "…" : "↗"}</span>
        </button>
      </form>
      <p className="switch">
        {isSigningUp ? "Already have an account?" : `New to ${PUBLIC_SITE_NAME}?`}{" "}
        <button type="button" onClick={toggleMode} disabled={pending}>
          {isSigningUp ? "Sign in" : "Create an account"} <span aria-hidden="true">→</span>
        </button>
      </p>
    </>
  );
}
