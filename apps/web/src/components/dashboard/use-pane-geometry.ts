import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

/** Effective pane size and reachable range in the resizer's own display unit. */
export type PaneGeometry = { value: number; min: number; max: number };

type Options = {
  /** Id of the pane element the resizer moves. */
  target: string;
  /** Report values as a percentage of the pane's container instead of pixels. */
  percentage: boolean;
  /** Requested range; the reported range is intersected with the CSS limits. */
  min: number;
  max: number;
};

export type PaneGeometryResult = {
  /** Measured semantics, or null while the pane cannot be measured. */
  geometry: PaneGeometry | null;
  /** Attach to the separator; it also resolves the CSS limit variables below. */
  rulerRef: RefObject<HTMLDivElement | null>;
};

/**
 * Resolve one `--cx-pane-*` limit in the ruler's containing block (the pane's container),
 * so percentages use the same basis as the grid track. Returns null when the expression is
 * missing or unusable, which keeps the caller on the requested fallback values.
 */
const resolveLimit = (ruler: HTMLElement, expression: string, scale: number): number | null => {
  if (!expression.trim() || !CSS.supports("width", expression)) return null;
  const previous = ruler.style.width;
  try {
    ruler.style.width = expression;
    const width = ruler.getBoundingClientRect().width / scale;
    return width > 0 ? width : null;
  } finally {
    ruler.style.width = previous;
  }
};

const sameGeometry = (current: PaneGeometry | null, next: PaneGeometry | null): boolean =>
  current === next ||
  (current !== null &&
    next !== null &&
    current.value === next.value &&
    current.min === next.min &&
    current.max === next.max);

/**
 * Report the pane size the layout actually applied, plus the range the resizer can reach.
 * The CSS limit variables declared in pane-resizer.css stay the single source: the separator
 * resolves them as its own width inside the pane's containing block, so the unit and the
 * percentage basis match the grid without a second clamp implementation.
 */
export function usePaneGeometry({ target, percentage, min, max }: Options): PaneGeometryResult {
  const rulerRef = useRef<HTMLDivElement>(null);
  const [geometry, setGeometry] = useState<PaneGeometry | null>(null);

  const measure = useCallback((): PaneGeometry | null => {
    const pane = document.getElementById(target);
    const ruler = rulerRef.current;
    const parent = pane?.parentElement;
    if (!pane || !ruler || !parent || pane.getClientRects().length === 0) return null;
    if (ruler.getClientRects().length === 0) return null;
    // Track percentages resolve against this box; clientWidth is that box for these panes.
    const scale = percentage ? parent.clientWidth / 100 : 1;
    if (scale <= 0) return null;
    const limits = getComputedStyle(ruler);
    const cssMin = resolveLimit(ruler, limits.getPropertyValue("--cx-pane-min"), scale);
    const cssMax = resolveLimit(ruler, limits.getPropertyValue("--cx-pane-max"), scale);
    if (cssMin === null || cssMax === null || cssMax < cssMin) return null;
    // Requests are clamped to [min, max], so the reachable range is that intersection.
    const reachableMin = Math.max(cssMin, Math.min(min, cssMax));
    const reachableMax = Math.min(cssMax, Math.max(max, cssMin));
    const value = pane.getBoundingClientRect().width / scale;
    return {
      value: Math.min(reachableMax, Math.max(reachableMin, value)),
      min: reachableMin,
      max: reachableMax,
    };
  }, [target, percentage, min, max]);

  useLayoutEffect(() => {
    const pane = document.getElementById(target);
    if (!pane) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const next = measure();
      setGeometry((current) => (sameGeometry(current, next) ? current : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    const observer = new ResizeObserver(schedule);
    observer.observe(pane);
    if (pane.parentElement) observer.observe(pane.parentElement);
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [measure, target]);

  return { geometry, rulerRef };
}
