import LandingHero from "./landing-hero";
import LandingWorkspace from "./landing-workspace";
import LandingWorkflow from "./landing-workflow";
import LandingClosing from "./landing-closing";

export default function LandingPage() {
  return (
    <main className="public-site" id="landing">
      <LandingHero />
      <LandingWorkspace />
      <LandingWorkflow />
      <LandingClosing />
    </main>
  );
}
