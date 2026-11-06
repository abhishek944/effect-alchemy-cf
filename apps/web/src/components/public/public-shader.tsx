import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

const ShaderRenderer = lazy(() => import("./shader-renderer"));

class ShaderBoundary extends Component<
  { children: ReactNode; onFailure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFailure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export default function PublicShader({ name, className }: { name: string; className?: string }) {
  const id = useId();
  const surface = useRef<HTMLDivElement>(null);
  const eager = name === "hero" || name === "auth";
  const [mounted, setMounted] = useState(eager);
  const [visible, setVisible] = useState(eager);
  const [ready, setReady] = useState(false);
  const reveal = useCallback(() => setReady(true), []);
  const [reduced, setReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [hidden, setHidden] = useState(() => document.hidden);
  const [failed, setFailed] = useState(false);
  const fail = useCallback(() => setFailed(true), []);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const preference = () => setReduced(media.matches);
    const visibility = () => setHidden(document.hidden);
    media.addEventListener("change", preference);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      media.removeEventListener("change", preference);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);
  useEffect(() => {
    const element = surface.current;
    if (!element) return undefined;
    const visibility = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    visibility.observe(element);
    const warmup = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setMounted(true);
          warmup.disconnect();
        }
      },
      { rootMargin: "300px 0px" },
    );
    if (!eager) warmup.observe(element);
    return () => {
      visibility.disconnect();
      warmup.disconnect();
    };
  }, [eager]);
  return (
    <div
      ref={surface}
      className={`shader-surface absolute inset-0 ${className ?? ""}`}
      data-shader-ready={ready && !failed}
      aria-hidden="true"
    >
      {failed ? (
        <span className="shader-error">Background animation unavailable</span>
      ) : (
        mounted && (
          <div className="shader-live absolute inset-0">
            <ShaderBoundary onFailure={fail}>
              <Suspense fallback={null}>
                <ShaderRenderer
                  id={`public-gradient-${name}-${id}`}
                  running={!hidden && (!ready || (visible && !reduced))}
                  animate={ready && visible && !hidden && !reduced}
                  onReady={reveal}
                  onFailure={fail}
                />
              </Suspense>
            </ShaderBoundary>
          </div>
        )
      )}
    </div>
  );
}
