import { useLayoutEffect, useRef, useState } from "react";
import { useImageBudget } from "./chat-image-budget";
import type { PreviewLease } from "./chat-file-preview-types";

export type PinnedImageState = "loading" | "ready" | "error";

/** Mutation guard only: which attempt currently owns a node's `src`. */
const nodeTokens = new WeakMap<HTMLImageElement, number>();
let nodeTokenCounter = 0;

/**
 * One native image attempt with an effect-local pending pin.
 *
 * The element renders without `src`; this effect retains the lease, assigns the
 * source and keeps that exact retain plus the source while the element is
 * mounted. The pin is released exactly once — only after the element has been
 * unmounted AND the decode promise has settled — so:
 * - a live, successfully decoded image is never blanked;
 * - an unmounted old node stays charged until its decode actually ends;
 * - a retry/remount takes its own fresh pin without touching the old one.
 * Readiness is keyed by source+lease identity, so stale completions can only
 * write their own record. Retry by remounting with a fresh source+attempt key.
 */
export function usePinnedImage(src: string | null, lease: PreviewLease | null) {
  const budget = useImageBudget();
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [result, setResult] = useState<{ key: string; state: PinnedImageState } | null>(null);
  const leaseKey = lease?.key ?? null;
  const decodedBytes = lease?.decodedBytes ?? 0;
  const previewBytes = lease?.previewBytes ?? 0;
  // Readiness is keyed by source and lease identity, so a stale completion can
  // only ever write its own record; the current render derives from its key.
  const stateKey = `${src ?? ""}|${leaseKey ?? ""}`;

  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!src || !img || leaseKey === null) return undefined;
    // A StrictMode replay reuses this exact node; only the latest attempt may
    // clear its `src`, while every attempt still releases its own budget key.
    const token = ++nodeTokenCounter;
    nodeTokens.set(img, token);
    let mounted = true;
    let settled = false;
    let pinned = false;
    let released = false;
    // The pin covers both mounted display and pending decode. A live element
    // keeps its retain and source; only an unmounted, settled old node frees.
    const release = () => {
      if (!pinned || released || !settled || mounted) return;
      released = true;
      pinned = false;
      budget.release(leaseKey);
      if (nodeTokens.get(img) === token) img.removeAttribute("src");
    };
    const settle = async () => {
      try {
        if (!budget.retain(leaseKey, decodedBytes, previewBytes)) throw new Error("budget");
        pinned = true;
        img.src = src;
        await img.decode();
        if (mounted) setResult({ key: stateKey, state: "ready" });
      } catch {
        if (mounted) setResult({ key: stateKey, state: "error" });
      } finally {
        // While mounted this is a no-op; an unmounted attempt frees here.
        settled = true;
        release();
      }
    };
    void settle();
    return () => {
      // Fence state; a settled attempt frees its old node now, pending waits.
      mounted = false;
      release();
    };
  }, [budget, decodedBytes, leaseKey, previewBytes, src, stateKey]);

  return { state: result?.key === stateKey ? result.state : "loading", imgRef };
}
