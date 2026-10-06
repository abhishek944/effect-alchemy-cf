import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { authClient } from "@/lib/auth-client";

export type AuthMode = "sign-in" | "sign-up";
type Props = { mode: AuthMode; onModeChange: (mode: AuthMode) => void };

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}

export default function AuthForm({ mode, onModeChange }: Props) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isSigningUp = mode === "sign-up";

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
        if (error) setFeedback(error.message || "Unable to create your account. Please try again.");
        else setNotice("Account created successfully.");
      } else {
        const { error } = await authClient.signIn.email({ email, password });
        if (error) setFeedback(error.message || "Unable to sign in. Please try again.");
      }
    } catch (error) {
      setFeedback(errorMessage(error));
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
        <p className="text-sm text-destructive" role="alert">
          {feedback}
        </p>
      )}
      {notice && (
        <output className="block text-sm text-foreground" aria-live="polite">
          {notice}
        </output>
      )}
      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        {isSigningUp && (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="name">
              Name
            </label>
            <Input id="name" name="name" autoComplete="name" required disabled={pending} />
          </div>
        )}
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="email">
            Email
          </label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            disabled={pending}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="password">
            Password
          </label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSigningUp ? "new-password" : "current-password"}
            minLength={isSigningUp ? 12 : 1}
            required
            disabled={pending}
          />
        </div>
        <Button className="w-full" type="submit" disabled={pending}>
          {pending
            ? isSigningUp
              ? "Creating account…"
              : "Signing in…"
            : isSigningUp
              ? "Create account"
              : "Sign in"}
        </Button>
      </form>
      <div className="border-t border-border pt-5 text-center text-sm text-muted-foreground">
        {isSigningUp ? "Already have an account?" : "New to the starter?"}{" "}
        <button
          type="button"
          className="font-medium text-primary underline-offset-4 hover:underline disabled:opacity-50"
          onClick={toggleMode}
          disabled={pending}
        >
          {isSigningUp ? "Sign in" : "Create an account"}
        </button>
      </div>
    </>
  );
}
