import AuthPanel from "./auth-panel";
import type { AuthMode } from "./auth-form";
import PublicBrand from "./public/public-brand";
import PublicShader from "./public/public-shader";
import RouteLink from "@/lib/route-link";
import "./public/styles/public.css";

type Props = {
  mode: AuthMode;
  checking: boolean;
  sessionError: string | null;
  notice?: string | null;
  /** Absent when this surface offers sign-in only; the admin portal is one. */
  onModeChange?: ((mode: AuthMode) => void) | undefined;
  /** Clerk's own switch links; each caller owns their origin. */
  signInHref: string;
  signUpHref: string;
  /** The brand and back links leave for the main UI when this origin is not it. */
  homeHref: string;
};

/**
 * The sign-in and sign-up page shared by the public site and the admin portal.
 * Callers pass their own destinations, so the presentation stays identical while
 * the portal's separate local origin still links back to the main UI.
 */
export default function AuthPage({
  mode,
  checking,
  sessionError,
  notice = null,
  onModeChange,
  signInHref,
  signUpHref,
  homeHref,
}: Props) {
  return (
    <div className="public-site public-auth page variant-B" data-phone="C">
      <div className="art" aria-hidden="true">
        <div className="shader-root">
          <div className="shader-field">
            <PublicShader name="auth" />
            <div className="shader-shade" />
          </div>
        </div>
      </div>
      <a className="skip" href="#account">
        Skip to account form
      </a>
      <header>
        <PublicBrand homeHref={homeHref} />
        <RouteLink className="back" href={homeHref}>
          Back to home <span aria-hidden="true">↗</span>
        </RouteLink>
      </header>
      <main>
        <section className="intro" aria-labelledby="intro-title">
          <p className="eyebrow">
            <i /> YOUR PERSONAL WORKSPACE
          </p>
          <h1 id="intro-title">
            Your personal <br />
            AI office.
          </h1>
          <p className="support">
            AI chats, files, and documents.
            <br />
            One personal workspace.
          </p>
        </section>
        <AuthPanel
          mode={mode}
          checking={checking}
          sessionError={sessionError}
          notice={notice}
          onModeChange={onModeChange}
          signInHref={signInHref}
          signUpHref={signUpHref}
        />
      </main>
    </div>
  );
}
