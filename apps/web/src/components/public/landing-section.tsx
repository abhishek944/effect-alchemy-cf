import { useEffect, useRef, type ReactNode } from "react";
import PublicShader from "./public-shader";

type Kind = "workspace" | "workflow" | "closing";

export default function LandingSection({ kind, children }: { kind: Kind; children: ReactNode }) {
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const section = sectionRef.current;
    const heading = section?.querySelector(".section-heading,.invite");
    if (!section || !heading) return undefined;
    const update = () =>
      section.style.setProperty(
        "--wash-height",
        `${Math.max(kind === "closing" ? 580 : 350, heading.getBoundingClientRect().bottom - section.getBoundingClientRect().top + 50)}px`,
      );
    const observer = new ResizeObserver(update);
    observer.observe(heading);
    update();
    return () => observer.disconnect();
  }, [kind]);
  return (
    <div
      className={`landing-${kind}`}
      data-variant="B"
      data-shader="D"
      data-mobile={kind === "workspace" ? "E" : undefined}
      data-workflow={kind === "workflow" ? "C" : undefined}
      data-workflow-phone={kind === "workflow" ? "E" : undefined}
      data-closing={kind === "closing" ? "C" : undefined}
      data-closing-phone={kind === "closing" ? "C" : undefined}
    >
      <section
        ref={sectionRef}
        id={kind === "closing" ? "start" : kind}
        className={`section direction-B${kind === "workflow" ? " workflow-C" : kind === "closing" ? " closing closing-C" : ""}`}
        tabIndex={-1}
        aria-labelledby={`${kind}-heading`}
      >
        {children}
        <div className="shader-root">
          <div className="shader-field" aria-hidden="true">
            <PublicShader name={kind} />
            <div className="shader-shade" />
          </div>
        </div>
      </section>
    </div>
  );
}
