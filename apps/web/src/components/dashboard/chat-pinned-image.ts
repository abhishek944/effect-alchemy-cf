import { useLayoutEffect, useRef, useState } from "react";

export type PinnedImageState = "loading" | "ready" | "error";

/** StrictMode can reuse a node; only its latest attempt may clear the source. */
const nodeTokens = new WeakMap<HTMLImageElement, object>();

/** Keep a mounted source intact; clean up an unmounted node after decode settles. */
export function usePinnedImage(src: string | null) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [result, setResult] = useState<{ src: string; state: PinnedImageState } | null>(null);
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (!src || !img) return undefined;
    const token = {};
    nodeTokens.set(img, token);
    let mounted = true;
    let settled = false;
    const release = () => {
      if (!mounted && settled && nodeTokens.get(img) === token) img.removeAttribute("src");
    };
    const decode = async () => {
      try {
        img.src = src;
        await img.decode();
        if (mounted) setResult({ src, state: "ready" });
      } catch {
        if (mounted) setResult({ src, state: "error" });
      } finally {
        settled = true;
        release();
      }
    };
    void decode();
    return () => {
      mounted = false;
      release();
    };
  }, [src]);
  return { state: result?.src === src ? result.state : "loading", imgRef };
}
