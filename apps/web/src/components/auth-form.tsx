import { SignIn, SignUp } from "@clerk/react";
import { PUBLIC_SITE_NAME } from "./public/public-brand";

export type AuthMode = "sign-in" | "sign-up";
type Props = {
  mode: AuthMode;
  signInHref: string;
  signUpHref: string;
  /**
   * The page's own account-creation affordance. A surface that can change mode offers
   * sign-up; without a mode switch it is sign-in only, so Clerk's sign-up prompt is
   * hidden there too. `| undefined` keeps it forwardable under
   * `exactOptionalPropertyTypes`.
   */
  onModeChange?: ((mode: AuthMode) => void) | undefined;
};

const appearance = { variables: { colorPrimary: "inherit" } };

/**
 * Clerk tags the sign-in card's account-creation action with the card's own action id
 * and older UI bundles use the sign-up id, so both selectors are listed; whichever is
 * absent is inert. Hiding only those actions keeps the footer branding, the
 * help/terms/privacy pages and the passkey and recovery actions.
 */
const signInOnlyAppearance = {
  variables: { colorPrimary: "inherit" },
  elements: {
    footerAction__signIn: { display: "none" },
    footerAction__signUp: { display: "none" },
  },
};

/**
 * Clerk owns the credential flow, its validation copy and the session cookie.
 * The page keeps its own heading and mode switch around the hosted form.
 * The caller supplies both switch destinations, so Clerk's built-in link stays on
 * the origin that owns the auth pages instead of falling back to the hosted
 * Account Portal on a route it cannot match.
 */
export default function AuthForm({ mode, onModeChange, signInHref, signUpHref }: Props) {
  const isSigningUp = mode === "sign-up";
  const signInOnly = !isSigningUp && !onModeChange;
  return (
    <>
      {isSigningUp ? (
        <SignUp routing="hash" signInUrl={signInHref} appearance={appearance} />
      ) : (
        <SignIn
          routing="hash"
          signInUrl={signInHref}
          signUpUrl={signUpHref}
          appearance={signInOnly ? signInOnlyAppearance : appearance}
        />
      )}
      {onModeChange && (
        <p className="switch">
          {isSigningUp ? "Already have an account?" : `New to ${PUBLIC_SITE_NAME}?`}{" "}
          <button type="button" onClick={() => onModeChange(isSigningUp ? "sign-in" : "sign-up")}>
            {isSigningUp ? "Sign in" : "Create an account"} <span aria-hidden="true">→</span>
          </button>
        </p>
      )}
    </>
  );
}
