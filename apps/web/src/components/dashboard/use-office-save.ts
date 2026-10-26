import { useCallback, useRef, useState, type RefObject } from "react";
import type { OfficeEditorHandle, OfficeSave } from "@starter/office-react";
import type { OpenOffice } from "@/lib/office-runtime";

type Lease = {
  current: () => OpenOffice | null;
  canResume: () => boolean;
  drain: (saved: OfficeSave) => Promise<OpenOffice>;
};
/** Native holds are reversible until commit drains server authority. Unknown holds never resume. */
export function useOfficeSave({
  lease,
  handle,
  loading,
  retired,
  report,
}: {
  lease: Lease;
  handle: OfficeEditorHandle | null;
  loading: RefObject<Promise<void> | null>;
  retired: RefObject<boolean>;
  report: (message: string) => void;
}) {
  const [phase, setPhase] = useState<"editing" | "held" | "drained" | "uncertain">("editing");
  const state = useRef(phase);
  const ack = useRef<OfficeSave | null>(null);
  const saving = useRef<Promise<OfficeSave | null> | null>(null);
  const phaseTo = useCallback((next: typeof phase) => {
    state.current = next;
    setPhase(next);
  }, []);
  const prepare = useCallback((): Promise<OfficeSave | null> => {
    if (saving.current !== null) return saving.current;
    const started = (async () => {
      await loading.current;
      if (retired.current) return null;
      const opened = lease.current();
      if (opened === null) return null; // Failed opening admitted no native input.
      if (opened.editor === null || opened.view.mode !== "edit") return null;
      if ((state.current === "held" || state.current === "drained") && ack.current !== null)
        return ack.current;
      try {
        const saved = await handle?.prepareToLeave();
        if (saved === undefined || saved.viewId !== opened.view.id)
          throw new Error("Native save acknowledgement is unavailable or changed.");
        ack.current = saved;
        phaseTo(opened.editor.state === "drained" ? "drained" : "held");
        return saved;
      } catch (error) {
        phaseTo("uncertain");
        report(
          "Native input or save is unconfirmed. Keep this editor open and retry confirmation.",
        );
        throw error;
      }
    })();
    const tracked = started.finally(() => {
      if (saving.current === tracked) saving.current = null;
    });
    saving.current = tracked;
    return tracked;
  }, [loading, retired, lease, handle, report, phaseTo]);
  const commit = async () => {
    const current = lease.current();
    if (retired.current || current === null || current.editor === null) return;
    if (ack.current === null || state.current === "uncertain")
      throw new Error("Office save must be confirmed before drain.");
    try {
      await lease.drain(ack.current);
      phaseTo("drained");
      report("");
    } catch (error) {
      phaseTo("uncertain");
      throw error;
    }
  };
  const cancel = async () => {
    if (state.current === "drained") {
      report(
        "This editor was saved and paused. Choose Resume editor to acquire fresh authorization.",
      );
      return;
    }
    if (state.current !== "held") return;
    if (!lease.canResume() || handle === null) {
      phaseTo("uncertain");
      report(
        "The saved hold cannot safely resume. Keep this editor open; authorization is unconfirmed.",
      );
      return;
    }
    try {
      await handle.resume();
      if (!lease.canResume()) {
        handle.stopInput();
        throw new Error("Office authorization changed while resuming.");
      }
      ack.current = null;
      phaseTo("editing");
      report("");
    } catch {
      phaseTo("uncertain");
      report("Input could not be resumed. Keep this editor open and retry confirmation.");
    }
  };
  const reset = () => {
    ack.current = null;
    phaseTo("editing");
  };
  return {
    prepare,
    commit,
    cancel,
    reset,
    phase,
    holdAndDrain: async () => {
      const saved = await prepare();
      await commit();
      return saved;
    },
  };
}
