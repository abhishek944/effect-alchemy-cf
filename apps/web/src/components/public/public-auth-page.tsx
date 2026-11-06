import AuthPanel from "../auth-panel";
import type { AuthMode } from "../auth-form";
import { authModePath } from "@/lib/public-auth-route";
import { navigate } from "@/lib/router";
import RouteLink from "@/lib/route-link";
import PublicBrand from "./public-brand";
import PublicShader from "./public-shader";

type Props = { mode: AuthMode; checking: boolean; sessionError: string | null };

export default function PublicAuthPage({ mode, checking, sessionError }: Props) {
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
        <PublicBrand />
        <RouteLink className="back" href="/">
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
          onModeChange={(next) => navigate(authModePath(next, window.location))}
        />
      </main>
    </div>
  );
}
