import { useEffect, useEffectEvent, useLayoutEffect, useState } from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import {
  openOfficeOriginal,
  OfficeOriginalPending,
  type OriginalOffice,
} from "@/lib/office-original";
import { savedOriginalUrl } from "@/lib/chat-library-api";
import { errorMessage } from "@/lib/chat-api";
import { useWorkspaceOffice } from "./workspace-office-context";
import { useWorkspacePreview } from "./workspace-preview-context";
import { OfficeSurface } from "./office-surface";

type Props = { file: SavedFile; id: string; archived: boolean };
export function OfficeOriginal(props: Props) {
  const [attempt, setAttempt] = useState({ sequence: 0, resume: false });
  const [state] = useState(() => ({ uncertain: false }));
  return (
    <OriginalAttempt
      key={attempt.sequence}
      {...props}
      resume={attempt.resume}
      state={state}
      retry={(resume) => setAttempt((old) => ({ sequence: old.sequence + 1, resume }))}
    />
  );
}

/** Imports are durable and rediscoverable; this surface holds no native input, so it never blocks navigation. */
function OriginalAttempt({
  file,
  id,
  archived,
  resume,
  retry,
  state,
}: Props & {
  resume: boolean;
  state: { uncertain: boolean };
  retry: (resume: boolean) => void;
}) {
  const { runtime, register, publishPending } = useWorkspaceOffice();
  const preview = useWorkspacePreview();
  const [owner] = useState(() => ({}));
  const reportTarget = useEffectEvent((opened: OriginalOffice) =>
    preview.resolveOffice(id, file.chatId, opened),
  );
  const [unresolved, setUnresolved] = useState(true);
  const [selection, setSelection] = useState<OriginalOffice | null>(null);
  const [error, setError] = useState<{ message: string; canContinue: boolean } | null>(null);
  useEffect(() => {
    // A mounted editor owns its own pending state; this surface never overwrites it.
    if (selection !== null) return undefined;
    publishPending(id, owner, unresolved);
    return () => publishPending(id, owner, false);
  }, [publishPending, id, owner, unresolved, selection]);
  /**
   * This surface never holds unsaved native input, so it never blocks workspace navigation.
   * The operation identity is durable: reopening the same file discovers it again.
   */
  useLayoutEffect(() => {
    if (selection) return undefined;
    return register(id, {
      owner,
      chatId: file.chatId,
      readOnly: true,
      prepareToLeave: async () => undefined,
      prepareSend: async () => {
        throw new Error("Open the confirmed Office draft before Send.");
      },
    });
  }, [register, id, file.chatId, owner, selection]);
  useEffect(() => {
    const active = new AbortController();
    void runtime
      .then((resolved) =>
        openOfficeOriginal(resolved, file, archived, active.signal, state, resume),
      )
      .then(
        (opened) => {
          if (!active.signal.aborted) {
            setUnresolved(false);
            // The provider owns convergence: a target already shown elsewhere drops this
            // tab instead of mounting a second editor for the same draft or review.
            reportTarget(opened);
            setSelection(opened);
          }
          return undefined;
        },
        (cause: unknown) => {
          if (!active.signal.aborted) {
            setUnresolved(state.uncertain || cause instanceof OfficeOriginalPending);
            setError({
              message: errorMessage(cause),
              canContinue: cause instanceof OfficeOriginalPending && cause.canContinue,
            });
          }
          return undefined;
        },
      );
    return () => {
      active.abort();
    };
  }, [runtime, file, archived, resume, state]);
  if (selection) return <OfficeSurface chatId={file.chatId} id={id} selection={selection} />;
  return (
    <section data-cx="office-surface" aria-label={file.name}>
      <p role={error ? "alert" : "status"}>
        {error?.message ||
          "Opening original in Univer as a draft. The saved original and Main stay unchanged…"}
      </p>
      <p>
        Office operation: file_open_{file.id}
        {error ? " · Reopen this file to check the same operation." : ""}
      </p>
      {error && (
        <button type="button" onClick={() => retry(false)}>
          Check original operation
        </button>
      )}
      {error?.canContinue && !archived && (
        <button type="button" onClick={() => retry(true)}>
          Continue original import
        </button>
      )}
      <a href={savedOriginalUrl(file)} download={file.name}>
        Download original
      </a>
    </section>
  );
}
