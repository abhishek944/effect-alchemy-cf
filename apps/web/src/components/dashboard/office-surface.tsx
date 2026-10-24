import { useEffect, useState } from "react";
import type { Draft } from "@starter/office-contract";
import {
  OfficeDraftControls,
  OfficeNativeEditor,
  OfficeReview,
  type FrameStatus,
} from "@starter/office-react";
import { useDashboardTheme } from "./theme";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useOfficeSurface } from "./use-office-surface";
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
    runtime,
    value: opened,
    error,
    busy,
    receipt,
    reviewId,
    holdAndDrain,
    save,
    resume,
    onOperation,
    pendingControl,
    admit,
    onReceipt,
    onBusy,
  } = useOfficeSurface(chatId, id, selection);
  const office = useWorkspaceOffice();
  const { publishPending } = office;
  const { theme: hostTheme } = useDashboardTheme();
  const theme = hostTheme === "light" || hostTheme === "paper" ? "light" : "dark";
  const [draft, setDraft] = useState<Draft | null>(null);
  const [connected, setConnected] = useState<string | null>(null);
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
    publishPending(id, publisher, pending);
    return () => publishPending(id, publisher, false);
  }, [publishPending, id, publisher, pending]);
  useEffect(() => {
    const active = new AbortController();
    if (runtime !== null && selection.target.scope.kind === "draft") {
      const target = selection.target;
      const scope = selection.target.scope;
      void runtime
        .run(runtime.client.office.draft({ params: { draftId: scope.draftId } }), {
          signal: active.signal,
        })
        .then((result) => {
          if (
            !active.signal.aborted &&
            result.id === scope.draftId &&
            result.documentId === target.documentId &&
            result.generation === scope.generation
          )
            setDraft(result);
          return undefined;
        })
        .catch(() => undefined); // No verified descriptor means Ready stays unavailable.
    }
    return () => {
      active.abort();
    };
  }, [runtime, selection]);
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
          disabled={office.busy || (pendingControl !== null && pendingControl !== "review")}
        />
        <OfficeReopen
          key={reviewId}
          runtime={runtime}
          selection={selection}
          onOperation={(operationId) => onOperation(operationId, "reopen")}
          onReceipt={onReceipt}
          admit={() => admit("reopen")}
          disabled={office.busy || (pendingControl !== null && pendingControl !== "reopen")}
        />
      </section>
    );
  return (
    <section data-cx="office-surface" aria-label={selection.title}>
      <header data-cx="office-actions">
        <strong>{selection.title}</strong>
        <button
          type="button"
          disabled={opened === null || busy || office.busy}
          onClick={() => void save()}
        >
          Save and pause
        </button>
        <button
          type="button"
          disabled={opened === null || busy || office.busy}
          onClick={() => void resume()}
        >
          Resume saved editor
        </button>
      </header>
      {error && (
        <p role="alert" data-cx="office-notice">
          {error}
        </p>
      )}
      {opened === null ? (
        <output data-cx="office-notice">
          {error ? "No native editor is available." : "Opening authorized native document…"}
        </output>
      ) : (
        <>
          <OfficeNativeEditor
            ref={native}
            view={opened.view}
            user={office.user}
            theme={theme}
            channelId={opened.channel.channelId}
            frameUrl="/office/frame.html"
            operation={receipt}
            onStatus={(next) => {
              setStatus(next);
              if (next === "saved" || next === "held" || next === "read-only")
                setConnected(opened.view.id);
            }}
          />
          {runtime !== null &&
            connected === opened.view.id &&
            draft !== null &&
            opened.editor !== null &&
            handle !== null && (
              <OfficeDraftControls
                client={runtime.client}
                run={runtime.run}
                draft={draft}
                editor={opened.editor}
                holdAndDrain={holdAndDrain}
                onOperation={(operationId) => onOperation(operationId, "ready")}
                onReceipt={onReceipt}
                onBusy={onBusy}
                admit={() => admit("ready")}
                disabled={office.busy || (pendingControl !== null && pendingControl !== "ready")}
              />
            )}
        </>
      )}
    </section>
  );
}
