import { useEffect, useRef, useState } from "react";
import type { Document, Draft } from "@starter/office-contract";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useWorkspacePreview } from "./workspace-preview-context";
import { OfficeSources } from "./office-sources";

/** Account-scoped Office descriptors, not invented per-chat provenance or original-file import. */
export function OfficeFiles({ active, refreshKey }: { active: boolean; refreshKey: string }) {
  const { runtime } = useWorkspaceOffice();
  const preview = useWorkspacePreview();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [cursors, setCursors] = useState<{ documents: string | null; drafts: string | null }>({
    documents: null,
    drafts: null,
  });
  const [moreBusy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState("");
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  const busy = moreBusy || loaded !== refreshKey;
  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    void runtime
      .then(async ({ client, run }) => {
        if (controller.signal.aborted) return undefined;
        setError("");
        const [docs, branches] = await Promise.all([
          run(client.office.list({ query: {} }), { signal: controller.signal }),
          run(client.office.drafts({ query: {} }), { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) {
          setDocuments([...docs.items]);
          setDrafts([...branches.items]);
          setCursors({ documents: docs.next, drafts: branches.next });
        }
        return undefined;
      })
      // Optional account descriptors stay quiet; the Files refresh control retries reads.
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          setLoaded(refreshKey);
        }
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [runtime, active, refreshKey]);
  const more = async (kind: "documents" | "drafts") => {
    const cursor = cursors[kind];
    const rows = kind === "documents" ? documents : drafts;
    if (busy || cursor === null || rows.length >= 200) return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    setBusy(true);
    setError("");
    try {
      const { client, run } = await runtime;
      if (kind === "documents") {
        const page = await run(client.office.list({ query: { cursor } }), {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (documents.length + page.items.length > 200) throw new Error("Office browser limit.");
        setDocuments([...documents, ...page.items]);
        setCursors((old) => ({ ...old, documents: page.next }));
      } else {
        const page = await run(client.office.drafts({ query: { cursor } }), {
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (drafts.length + page.items.length > 200) throw new Error("Office browser limit.");
        setDrafts([...drafts, ...page.items]);
        setCursors((old) => ({ ...old, drafts: page.next }));
      }
    } catch {
      if (!controller.signal.aborted)
        setError(
          "More Office rows are unavailable or exceed the 200-row browser budget. Refresh reloads the first pages; it cannot raise that limit or restore an unavailable service.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  useEffect(
    () => () => {
      request.current?.abort();
    },
    [],
  );
  const savedDocuments = documents.filter((document) => document.revision !== null);
  if (
    savedDocuments.length === 0 &&
    drafts.length === 0 &&
    cursors.documents === null &&
    cursors.drafts === null
  )
    return null;
  return (
    <section data-cx="office-files" aria-label="Account Office documents">
      {error && <p role="alert">{error}</p>}
      {busy && <output>Reading Office files…</output>}
      <ul>
        {savedDocuments.map((document) => (
          <li key={document.id}>
            <button
              type="button"
              disabled={!active || busy}
              onClick={() =>
                preview.openOffice({
                  title: `${document.title} · Main`,
                  target: { documentId: document.id, scope: { kind: "main" } },
                  reviewId: null,
                  attachments: [],
                })
              }
            >
              {document.title} · Main r{document.revision}
            </button>
            <OfficeSources documentId={document.id} active={active} />
          </li>
        ))}
      </ul>
      <ul>
        {drafts.map((draft) => (
          <li key={draft.id}>
            <button
              type="button"
              disabled={!active || busy || draft.status === "merging"}
              onClick={() =>
                preview.openOffice({
                  title: `${documents.find((document) => document.id === draft.documentId)?.title ?? "Office draft"} · ${draft.status}`,
                  target: {
                    documentId: draft.documentId,
                    scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
                  },
                  reviewId: draft.status === "ready" ? draft.reviewId : null,
                  attachments: [],
                })
              }
            >
              {documents.find((document) => document.id === draft.documentId)?.title ??
                draft.documentId}{" "}
              · {draft.status} · generation {draft.generation}
            </button>
            <OfficeSources documentId={draft.documentId} active={active} />
          </li>
        ))}
      </ul>
      {cursors.documents !== null && (
        <button
          type="button"
          disabled={busy || documents.length >= 200}
          onClick={() => void more("documents")}
        >
          More Office documents
        </button>
      )}
      {cursors.drafts !== null && (
        <button
          type="button"
          disabled={busy || drafts.length >= 200}
          onClick={() => void more("drafts")}
        >
          More Office drafts
        </button>
      )}
    </section>
  );
}
