import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { Schema } from "effect";
import { View } from "@starter/office-contract";
import type { OfficeEditorHandle, OfficeRuntime, OfficeSave } from "@starter/office-react";
import { drainOffice, type OpenOffice } from "@/lib/office-runtime";

const sameView = Schema.toEquivalence(View);
type Lease = {
  value: OpenOffice;
  terminal: boolean;
  lost: boolean;
  running: Promise<void> | null;
  timer: ReturnType<typeof setTimeout> | null;
};
const live = (lease: Lease) =>
  !lease.lost &&
  lease.value.editor?.state === "active" &&
  Math.min(lease.value.editor.expiresAt, lease.value.view.expiresAt) > Date.now();

/** One editor owner orders the existing renewal timer and terminal drain. No UI-busy pause. */
export function useOfficeEditorLease(
  runtime: OfficeRuntime | null,
  opened: OpenOffice | null,
  handle: OfficeEditorHandle | null,
  renewed: (value: OpenOffice) => void,
  failed: (message: string) => void,
) {
  const scope = useRef<Lease | null>(null);
  const editorId = opened?.editor?.id;
  const epoch = opened?.editor?.epoch;
  const viewId = opened?.view.id;
  const publish = useEffectEvent((lease: Lease) => renewed(lease.value));
  const fail = useEffectEvent((lease: Lease) => {
    lease.lost = true;
    if (scope.current !== lease) return;
    failed(
      "Office authorization or drain is unconfirmed. Keep this editor open; input is stopped.",
    );
    handle?.stopInput();
  });
  useLayoutEffect(() => {
    if (
      opened === null ||
      (scope.current?.value.view.id === opened.view.id &&
        scope.current.value.editor?.id === opened.editor?.id &&
        scope.current.value.editor?.epoch === opened.editor?.epoch)
    )
      return;
    scope.current = { value: opened, terminal: false, lost: false, running: null, timer: null };
  }, [opened]);
  useEffect(() => {
    const lease = scope.current;
    if (
      runtime === null ||
      lease === null ||
      lease.value.editor === null ||
      lease.value.editor.id !== editorId ||
      lease.value.editor.epoch !== epoch ||
      lease.value.view.id !== viewId
    )
      return undefined;
    let disposed = false;
    const schedule = () => {
      if (disposed || lease.terminal || lease.lost) return;
      const remaining =
        Math.min(lease.value.editor?.expiresAt ?? 0, lease.value.view.expiresAt) - Date.now();
      if (remaining <= 0) {
        fail(lease);
        return;
      }
      lease.timer = setTimeout(
        () => {
          void tick();
        },
        Math.min(10_000, remaining / 3),
      );
    };
    const tick = async () => {
      if (disposed || lease.terminal || lease.lost || lease.running !== null) return;
      if (lease.timer !== null) clearTimeout(lease.timer);
      lease.timer = null;
      const task = (async () => {
        if (!live(lease)) throw new Error("Office lease expired.");
        const current = lease.value;
        if (current.editor === null) throw new Error("Office Editor is unavailable.");
        // Drain joins this writer. Timeout is unknown authority, never permission to drain.
        const editor = await runtime.run(
          runtime.client.office.editor({
            payload: { kind: "renew", editorId: current.editor.id },
          }),
          { signal: AbortSignal.timeout(30_000) },
        );
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
        lease.value = { ...current, editor, view: editor.view };
        if (!disposed && scope.current === lease) publish(lease);
      })();
      lease.running = task;
      try {
        await task;
      } catch {
        if (!disposed) fail(lease);
        else lease.lost = true;
      } finally {
        if (lease.running === task) lease.running = null;
        schedule();
      }
    };
    const reconcile = () => {
      if (document.visibilityState === "visible" && !lease.terminal) void tick();
    };
    schedule();
    document.addEventListener("visibilitychange", reconcile);
    window.addEventListener("online", reconcile);
    return () => {
      disposed = true;
      if (lease.timer !== null) clearTimeout(lease.timer);
      document.removeEventListener("visibilitychange", reconcile);
      window.removeEventListener("online", reconcile);
    };
  }, [runtime, editorId, epoch, viewId]);
  const drain = useCallback(
    async (saved: OfficeSave): Promise<OpenOffice> => {
      const lease = scope.current;
      if (lease === null || runtime === null) throw new Error("Office lease is unavailable.");
      lease.terminal = true; // Synchronous admission stop, before awaiting the active writer.
      if (lease.timer !== null) clearTimeout(lease.timer);
      try {
        await lease.running;
        if (lease.value.editor?.state === "drained") return lease.value;
        if (!live(lease)) throw new Error("Office authorization is unavailable.");
        // A browser abort would not prove the server stopped; keep ownership until settlement.
        lease.value = await drainOffice(runtime, lease.value, saved, AbortSignal.timeout(30_000));
        if (scope.current === lease) renewed(lease.value);
        return lease.value;
      } catch (error) {
        lease.lost = true;
        handle?.stopInput();
        failed(
          "Server drain or authorization is unconfirmed. Keep this editor open; input is stopped.",
        );
        throw error;
      }
    },
    [runtime, renewed, handle, failed],
  );
  const canResume = () => {
    const lease = scope.current;
    return lease !== null && !lease.terminal && live(lease);
  };
  return { drain, canResume, current: () => scope.current?.value ?? null };
}
