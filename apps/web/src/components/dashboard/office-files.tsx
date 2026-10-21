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
  const [version, setVersion] = useState(0);
  const request = useRef<AbortController | null>(null);
  const readKey = `${refreshKey}:${version}`;
  const busy = moreBusy || loaded !== readKey;
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
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Office documents could not be read. Saved originals are unchanged.");
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy(false);
          setLoaded(readKey);
        }
      });
    return () => {
      controller.abort();
      request.current?.abort();
    };
  }, [runtime, active, readKey]);
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
          "More Office rows are unavailable or exceed the 200-row browser budget. Refresh to retry.",
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
  return (
    <section data-cx="office-files" aria-label="Account Office documents">
      <header>
        <h3>Office documents · your account</h3>
        <button
          type="button"
          disabled={busy || !active}
          onClick={() => setVersion((value) => value + 1)}
        >
          Refresh Office files
        </button>
      </header>
      <p>
        Saved Office documents and drafts across your account. Attaching an original never creates a
        document automatically.
      </p>
      {error && <p role="alert">{error}</p>}
      {busy && <output>Reading Office files…</output>}
      {!busy && !error && documents.length === 0 && drafts.length === 0 && (
        <p>No Office documents yet. Send an original and ask the assistant what to create.</p>
      )}
      <ul>
        {documents
          .filter((document) => document.revision !== null)
          .map((document) => (
            <li key={document.id}>
              <button
                type="button"
                disabled={!active || busy}
                onClick={() =>
                  preview.openOffice({
                    title: `${document.title} · Main`,
                    target: { documentId: document.id, scope: { kind: "main" } },
                    reviewId: null,
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
