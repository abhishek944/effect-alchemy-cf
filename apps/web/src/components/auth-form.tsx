import { SignIn, SignUp } from "@clerk/react";
import { PUBLIC_SITE_NAME } from "./public/public-brand";

export type AuthMode = "sign-in" | "sign-up";
type Props = { mode: AuthMode; onModeChange: (mode: AuthMode) => void };

/**
 * Clerk owns the credential flow, its validation copy and the session cookie.
 * The page keeps its own heading and mode switch around the hosted form.
 */
export default function AuthForm({ mode, onModeChange }: Props) {
  const isSigningUp = mode === "sign-up";
  return (
    <>
      {isSigningUp ? (
        <SignUp
          routing="hash"
          signInUrl="#/sign-in"
          appearance={{ variables: { colorPrimary: "inherit" } }}
        />
      ) : (
        <SignIn
          routing="hash"
          signUpUrl="#/sign-up"
          appearance={{ variables: { colorPrimary: "inherit" } }}
        />
      )}
      <p className="switch">
        {isSigningUp ? "Already have an account?" : `New to ${PUBLIC_SITE_NAME}?`}{" "}
        <button type="button" onClick={() => onModeChange(isSigningUp ? "sign-in" : "sign-up")}>
          {isSigningUp ? "Sign in" : "Create an account"} <span aria-hidden="true">→</span>
        </button>
      </p>
    </>
  );
}
