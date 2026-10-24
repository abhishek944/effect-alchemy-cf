import { useEffect, useEffectEvent, type Dispatch, type SetStateAction } from "react";
import { Schema } from "effect";
import { View } from "@starter/office-contract";
import type { OfficeEditorHandle, OfficeRuntime } from "@starter/office-react";
import type { OpenOffice } from "@/lib/office-runtime";

const sameView = Schema.toEquivalence(View);
/** Renew only this mounted editor's lease; native transport, input and revisions remain untouched. */
export function useOfficeEditorLease(
  runtime: OfficeRuntime | null,
  opened: OpenOffice | null,
  handle: OfficeEditorHandle | null,
  paused: boolean,
  renewed: Dispatch<SetStateAction<OpenOffice | null>>,
  failed: (message: string) => void,
) {
  const editorId = opened?.editor?.id;
  const epoch = opened?.editor?.epoch;
  const viewId = opened?.view.id;
  const state = opened?.editor?.state;
  const renew = useEffectEvent(async (signal: AbortSignal) => {
    const current = opened;
    if (runtime === null || current?.editor === null || current === null) return 10_000;
    const editor = await runtime.run(
      runtime.client.office.editor({
        payload: { kind: "renew", editorId: current.editor.id },
      }),
      { signal },
    );
    signal.throwIfAborted();
    if (
      editor.id !== current.editor.id ||
      editor.epoch !== current.editor.epoch ||
      editor.state !== "active" ||
      editor.expiresAt <= Date.now() ||
      editor.expiresAt > editor.view.expiresAt ||
      editor.expiresAt < current.editor.expiresAt ||
      editor.view.expiresAt < current.view.expiresAt ||
      !sameView({ ...editor.view, expiresAt: 0 }, { ...current.view, expiresAt: 0 })
    )
      throw new Error("The editor lease changed identity.");
    renewed((latest) =>
      latest?.editor?.id === editor.id &&
      latest.editor.epoch === editor.epoch &&
      latest.editor.state === "active" &&
      latest.editor.expiresAt <= editor.expiresAt
        ? { ...latest, editor, view: editor.view }
        : latest,
    );
    return Math.min(10_000, Math.max(1, (editor.expiresAt - Date.now()) / 3));
  });
  const fail = useEffectEvent(() => {
    failed("Office authorization could not be renewed. Keep this editor open; input is stopping.");
    // This persistent stop is independent of native readiness, composition and save confirmation.
    handle?.stopInput();
  });
  useEffect(() => {
    if (
      runtime === null ||
      editorId === undefined ||
      epoch === undefined ||
      viewId === undefined ||
      state !== "active" ||
      paused
    )
      return undefined;
    const active = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const delay = await renew(active.signal);
        if (!active.signal.aborted) timer = setTimeout(() => void tick(), delay);
      } catch {
        if (!active.signal.aborted) fail();
      }
    };
    timer = setTimeout(() => void tick(), 10_000);
    return () => {
      active.abort();
      clearTimeout(timer);
    };
  }, [runtime, editorId, epoch, viewId, state, paused]);
}
