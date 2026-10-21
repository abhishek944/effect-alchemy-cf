import { useEffect, useState } from "react";
import type { OfficeSourceLink } from "@starter/office-contract";
import { useWorkspaceOffice } from "./workspace-office-context";

type Window = { items: OfficeSourceLink[]; next: string | null; error: string; loaded: string };
const empty = (): Window => ({ items: [], next: null, error: "", loaded: "" });

/** Explicitly requested draft import history; never infers publication or source identity. */
export function OfficeSources({ documentId, active }: { documentId: string; active: boolean }) {
  const { runtime } = useWorkspaceOffice();
  const [open, setOpen] = useState(false);
  const [request, setRequest] = useState<{ cursor: string | null; version: number }>({
    cursor: null,
    version: 0,
  });
  const [data, setData] = useState<Window>(empty);
  const key = JSON.stringify([documentId, request]);
  const busy = data.loaded !== key;
  useEffect(() => {
    if (!open || !active) return undefined;
    const controller = new AbortController();
    void runtime
      .then(async ({ client, run }) => {
        if (controller.signal.aborted) return undefined;
        const page = await run(
          client.office.sources({
            params: { documentId },
            query: request.cursor === null ? {} : { cursor: request.cursor },
          }),
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return undefined;
        if (page.items.some((item) => item.documentId !== documentId))
          throw new Error("Office source document mismatch.");
        setData((old) => {
          const rows = new Map(
            (request.cursor === null ? [] : old.items).map((item) => [item.operationId, item]),
          );
          for (const item of page.items) rows.set(item.operationId, item);
          if (rows.size > 200)
            return {
              ...old,
              loaded: key,
              error: "This page exceeds the 200-row history window. Refresh to restart.",
            };
          return { items: [...rows.values()], next: page.next, error: "", loaded: key };
        });
        return undefined;
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setData((old) => ({
            ...old,
            error: "Import history could not be read. Originals are unchanged.",
            loaded: key,
          }));
      });
    return () => controller.abort();
  }, [runtime, documentId, active, open, request, key]);
  const refresh = () => {
    setData(empty());
    setRequest((old) => ({ cursor: null, version: old.version + 1 }));
  };
  return (
    <details
      onToggle={(event) => {
        const showing = event.currentTarget.open;
        if (showing) refresh();
        setOpen(showing);
      }}
    >
      <summary>Imported originals · draft history</summary>
      <p>
        Confirmed draft imports, not proof of merge or current main content. Older unrecorded
        sources are not guessed.
      </p>
      {busy && <output>Reading import history…</output>}
      {data.error && <p role="alert">{data.error}</p>}
      {!busy && !data.error && data.items.length === 0 && <p>No recorded original imports.</p>}
      <ul>
        {data.items.map((item) => (
          <li key={item.operationId}>
            <a
              href={`/api/chats/${encodeURIComponent(item.chatId)}/attachments/${encodeURIComponent(item.fileRef)}`}
              download
            >
              {item.name}
            </a>{" "}
            · draft {item.draftId.slice(0, 8)} · generation {item.generation}
          </li>
        ))}
      </ul>
      {data.next !== null && (
        <button
          type="button"
          disabled={busy || !active || data.items.length >= 200 || Boolean(data.error)}
          onClick={() => setRequest((old) => ({ cursor: data.next, version: old.version + 1 }))}
        >
          More import history
        </button>
      )}
      {data.items.length >= 200 && data.next !== null && (
        <p>Showing 200 imports. Refresh to start again.</p>
      )}
      <button type="button" disabled={busy || !active} onClick={refresh}>
        Refresh import history
      </button>
    </details>
  );
}
