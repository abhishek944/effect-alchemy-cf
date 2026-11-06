import RouteLink from "@/lib/route-link";
import PublicBrand from "./public-brand";
import PublicShader from "./public-shader";

export default function LandingHero() {
  return (
    <div className="landing-hero" data-variant="B" data-copy="B" data-mobile="B" data-entry="B">
      <section
        id="top"
        className="hero variant-B mobile-B"
        tabIndex={-1}
        aria-labelledby="headline"
      >
        <a className="skip" href="#headline">
          Skip to content
        </a>
        <header>
          <PublicBrand />
          <nav aria-label="Main navigation">
            <a href="#workspace">
              <span className="link-content">Explore</span>
            </a>
            <RouteLink className="sign-in" href="/login">
              <span className="link-content">
                Sign in <span aria-hidden="true">↗</span>
              </span>
            </RouteLink>
          </nav>
        </header>
        <div className="visual">
          <PublicShader name="hero" className="shader" />
          <div className="visual-shade" />
          <div className="orbital-line" />
        </div>
        <section className="content" aria-labelledby="headline">
          <p className="eyebrow">
            <i /> YOUR PERSONAL AI WORKSPACE
          </p>
          <h1 id="headline" tabIndex={-1}>
            <span>Your personal</span>
            <span>AI office.</span>
          </h1>
          <div className="details">
            <p className="description">
              AI chats, files, and documents.
              <br />
              One personal workspace.
            </p>
            <div className="actions">
              <RouteLink className="primary" href="/signup">
                Get started <span aria-hidden="true">↗</span>
              </RouteLink>
              <a className="secondary" href="#workspace">
                <span className="link-content">
                  Explore the workspace <span aria-hidden="true">↓</span>
                </span>
              </a>
            </div>
          </div>
        </section>
        <footer>
          <span className="chapter">
            <b>01 /</b> A LITTLE ROOM TO THINK BIG
          </span>
          <span className="scroll-note">
            MADE FOR YOUR NEXT IDEA <span>↓</span>
          </span>
        </footer>
      </section>
    </div>
  );
}
