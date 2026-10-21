import { useEffect, useRef, useState } from "react";
import { appendReviewPage, type ReviewEvidence } from "./review-data.ts";
import type { OfficeRuntime } from "./runtime.ts";

export function useReviewEvidence({ client, run }: OfficeRuntime, reviewId: string) {
  const [evidence, setEvidence] = useState<ReviewEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const load = useRef<AbortController | null>(null);
  useEffect(() => {
    load.current?.abort();
    const active = new AbortController();
    load.current = active;
    setLoading(true);
    setError("");
    setEvidence(null);
    void run(client.office.review({ params: { reviewId }, query: {} }), { signal: active.signal })
      .then((page) => {
        if (!active.signal.aborted) {
          if (page.reviewId !== reviewId) throw new Error("Review identity mismatch.");
          setEvidence(appendReviewPage({ page, changes: [] }, page));
        }
        return undefined;
      })
      .catch(() => {
        if (!active.signal.aborted)
          setError("Exact review could not be loaded. Approval is unavailable.");
      })
      .finally(() => {
        if (!active.signal.aborted) setLoading(false);
      });
    return () => {
      active.abort();
    };
  }, [client, run, reviewId, version]);
  const more = async () => {
    if (evidence === null || evidence.page.changes.next === null || loading) return;
    const current = evidence;
    const active = new AbortController();
    load.current?.abort();
    load.current = active;
    setLoading(true);
    try {
      const page = await run(
        client.office.review({
          params: { reviewId },
          query: { cursor: current.page.changes.next },
        }),
        { signal: active.signal },
      );
      if (!active.signal.aborted) setEvidence(appendReviewPage(current, page));
    } catch {
      if (!active.signal.aborted)
        setError("Exact change pages are incomplete or changed. Refresh the review.");
    } finally {
      if (!active.signal.aborted) setLoading(false);
    }
  };
  useEffect(
    () => () => {
      load.current?.abort();
    },
    [],
  );
  return { evidence, loading, error, more, refresh: () => setVersion((n) => n + 1) };
}
