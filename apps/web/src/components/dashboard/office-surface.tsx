import { useEffect, useState } from "react";
import { OfficeNativeEditor, OfficeReview, type FrameStatus } from "@starter/office-react";
import type { Document } from "@starter/office-contract";
import { useDashboardTheme } from "./theme";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useWorkspacePreview } from "./workspace-preview-context";
import { useOfficeSurface } from "./use-office-surface";
import { useNativeReferenceSource } from "./use-native-reference-source";
import { OfficeReopen } from "./office-reopen";
import type { OfficeSelection } from "./workspace-preview-model";
import "@starter/office-react/styles.css";
import "./workspace-office.css";
export function OfficeSurface({
  chatId,
  id,
  selection,
}: {
  chatId: string;
  id: string;
  selection: OfficeSelection;
}) {
  const {
    native,
    handle,
    referenceState,
    report,
    runtime,
    value: opened,
    error,
    busy,
    reviewId,
    onOperation,
    pendingControl,
    admit,
    onReceipt,
  } = useOfficeSurface(chatId, id, selection);
  const onSelection = useNativeReferenceSource({
    chatId,
    id,
    selection,
    opened,
    handle,
    runtime,
    state: referenceState,
    report,
  });
  const office = useWorkspaceOffice();
  const { publishPending } = office;
  const { resolveOffice } = useWorkspacePreview();
  const [document, setDocument] = useState<Document | null>(null);
  const documentId = selection.target.documentId;
  const title =
    selection.title === "Office document" && document?.id === documentId
      ? document.title
      : selection.title;
  useEffect(() => {
    if (runtime === null || selection.title !== "Office document") return undefined;
    const active = new AbortController();
    const signal = AbortSignal.any([active.signal, AbortSignal.timeout(30_000)]);
    // Display metadata belongs to this mounted owner; it never gates or reopens an editor.
    void runtime.run(runtime.client.office.document({ params: { documentId } }), { signal }).then(
      (value) => {
        if (!signal.aborted && value.id === documentId) setDocument(value);
        return undefined;
      },
      () => undefined, // A missing title must not become a native save/recovery failure.
    );
    return () => active.abort();
  }, [runtime, documentId, selection.title]);
  useEffect(() => {
    resolveOffice(id, chatId, { ...selection, title, reviewId });
  }, [resolveOffice, id, chatId, selection, title, reviewId]);
  const { theme: hostTheme } = useDashboardTheme();
  const theme = hostTheme === "light" || hostTheme === "paper" ? "light" : "dark";
  const [status, setStatus] = useState<FrameStatus>("loading");
  const [publisher] = useState(() => ({}));
  // Native "held" is only the SDK ACK; a confirmed save also needs the server drain.
  const confirmed =
    status === "saved" ||
    status === "read-only" ||
    (status === "held" && opened?.editor?.state === "drained");
  const editable = reviewId === null && opened !== null && opened.editor !== null;
  // Unresolved save/drain/lease failures stay pending until a successful retry clears them.
  const pending = busy || pendingControl !== null || error !== "" || (editable && !confirmed);
  useEffect(() => {
    publishPending(chatId, id, publisher, pending);
    return () => publishPending(chatId, id, publisher, false);
  }, [publishPending, chatId, id, publisher, pending]);
  if (reviewId === null && opened === null && !error)
    return (
      <section data-cx="office-opening" aria-label={title}>
        <output>Opening…</output>
      </section>
    );
  if (runtime !== null && reviewId !== null)
    return (
      <section data-cx="office-surface">
        {error && <p role="alert">{error}</p>}
        <OfficeReview
          client={runtime.client}
          run={runtime.run}
          reviewId={reviewId}
          user={office.user}
          theme={theme}
          frameUrl="/office/frame.html"
          onOperation={(operationId) => onOperation(operationId, "review")}
          onReceipt={onReceipt}
          admit={() => admit("review")}
          disabled={
            office.busyFor(chatId, id) || (pendingControl !== null && pendingControl !== "review")
          }
        />
        <OfficeReopen
          key={reviewId}
          chatId={chatId}
          runtime={runtime}
          selection={selection}
          onOperation={(operationId) => onOperation(operationId, "reopen")}
          onReceipt={onReceipt}
          admit={() => admit("reopen")}
          disabled={
            office.busyFor(chatId, id) || (pendingControl !== null && pendingControl !== "reopen")
          }
        />
      </section>
    );
  return (
    <section data-cx="office-surface" aria-label={title}>
      {opened === null && error && <p role="alert">{error}</p>}
      {opened !== null && (
        <OfficeNativeEditor
          ref={native}
          view={opened.view}
          user={office.user}
          theme={theme}
          channelId={opened.channel.channelId}
          frameUrl="/office/frame.html"
          onStatus={setStatus}
          onSelection={onSelection}
        />
      )}
    </section>
  );
}
