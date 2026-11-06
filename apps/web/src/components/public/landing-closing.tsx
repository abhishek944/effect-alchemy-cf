import RouteLink from "@/lib/route-link";
import LandingSection from "./landing-section";
import { PUBLIC_SITE_NAME } from "./public-brand";

export default function LandingClosing() {
  return (
    <LandingSection kind="closing">
      <div className="invite">
        <div className="invite-title">
          <p className="eyebrow">
            <i /> 03 / YOUR NEXT IDEA
          </p>
          <h2 id="closing-heading" tabIndex={-1}>
            Your next idea
            <br /> starts here.
          </h2>
        </div>
        <div className="invite-actions">
          <p className="closing-intro">
            AI chats, files, and documents.
            <br />
            One personal workspace.
          </p>
          <div className="closing-actions">
            <RouteLink className="primary" href="/signup">
              Get started <span aria-hidden="true">↗</span>
            </RouteLink>
            <RouteLink className="secondary" href="/login">
              Sign in <span aria-hidden="true">→</span>
            </RouteLink>
          </div>
        </div>
      </div>
      <footer className="closing-footer">
        <a className="brand" href="#top">
          {PUBLIC_SITE_NAME}
        </a>
        <nav aria-label="Footer">
          <a href="#workspace">Workspace</a>
          <a href="#workflow">How it works</a>
        </nav>
        <a href="#top" className="back-top">
          Back to top <span aria-hidden="true">↑</span>
        </a>
      </footer>
    </LandingSection>
  );
}
