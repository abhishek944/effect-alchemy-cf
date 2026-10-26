import { createNativeApplication, loadNativeView } from "./native.ts";
import { nativeLifecycle, readNativeReason } from "./lifecycle.ts";
import { nativeCaptures } from "./captures.ts";
import { performFrameOperation } from "./operation.ts";
import {
  readFrameRequest,
  reportFrameEvent,
  wireResultReason,
  type FramePhase,
  type FrameResponse,
} from "./messages.ts";
import { confirmNativeRendering } from "./rendering.ts";
import { frameOwnership } from "./ownership.ts";
import { bindFrameErrors } from "./diagnostics.ts";
/** CSS/runtime isolation only. All native HTTP/WebSocket endpoints still require host authentication. */
export function mountOfficeFrame(container: HTMLElement) {
  const nonce = new URLSearchParams(location.hash.slice(1)).get("officeFrame");
  if (window.parent === window || nonce === null || !/^[a-f0-9]{64}$/.test(nonce))
    throw new Error("Office frame requires a bound same-origin parent.");
  const origin = location.origin;
  let disposed = false;
  let initialized = false;
  let failed = false;
  let native: ReturnType<typeof createNativeApplication> | null = null;
  let lifecycle: ReturnType<typeof nativeLifecycle> | null = null;
  let captures: ReturnType<typeof nativeCaptures> | null = null;
  let revision = 0;
  let release: string | undefined;
  let serial = Promise.resolve();
  const operations = frameOwnership();
  const send = (message: FrameResponse) => {
    if (!disposed) window.parent.postMessage(message, origin);
  };
  const status = (value: "loading" | "error") =>
    send({ kind: "status", nonce, status: value, revision });
  const fail = () => {
    if (disposed) return;
    failed = true;
    container.inert = true;
    captures?.dispose();
    lifecycle?.fail();
    status("error");
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (event.source !== window.parent || event.origin !== origin || disposed) return;
    let message;
    try {
      message = readFrameRequest(event.data);
    } catch {
      return;
    }
    if (message.nonce !== nonce) return;
    if (message.kind === "dispose") {
      dispose();
      return;
    }
    if (message.kind === "stop-input") {
      fail(); // Persistent, including during initialization or an unfinished composition.
      return;
    }
    if (message.kind === "init") {
      if (initialized) return;
      initialized = true;
      release = message.release;
      const input = message.input;
      const { view, theme, user } = input;
      if (input.view.expiresAt <= Date.now()) {
        reportFrameEvent({
          service: "office-frame",
          operation: "frame.init",
          phase: "snapshot",
          reason: "expired",
          release,
          associationId: input.view.id,
        });
        status("error");
        return;
      }
      status("loading");
      container.inert = true;
      let phase: FramePhase = "init";
      serial = (async () => {
        if (input.view.nativeTarget.kind !== "pinned-snapshot")
          await import("@univerjs-pro/collaboration-client/facade");
        if (input.view.kind === "slide") await import("@univerjs-pro/slides/facade");
        native = createNativeApplication(container, view.kind, theme, user, input);
        phase = "snapshot";
        await loadNativeView(native, input);
        phase = "render";
        await confirmNativeRendering(native.injector, view.kind, view.nativeTarget.unitId);
        if (disposed || failed) return;
        lifecycle = nativeLifecycle(native, input, (state, confirmed) => {
          revision = confirmed;
          send({ kind: "status", nonce, status: state, revision });
        });
        captures = nativeCaptures(native, input, container, (capture) => {
          if (!failed) send({ kind: "selection", nonce, capture });
        });
        container.inert = false;
      })().catch((cause) => {
        if (disposed) return;
        const tagged = readNativeReason(cause);
        reportFrameEvent({
          service: "office-frame",
          operation: "frame.init",
          phase,
          reason: tagged?.reason ?? "native",
          release,
          associationId: input.view.id,
        });
        fail();
        try {
          native?.univer.dispose();
        } catch {
          // A cleanup failure must never turn failed initialization into readiness.
        }
        native = null;
      });
      return;
    }
    if (message.kind === "theme") {
      native?.univerAPI.toggleDarkMode(message.theme === "dark");
      return;
    }
    const owned = operations.claim(message.requestId);
    if (owned !== "accepted") {
      // Duplicates are already owned; bounded capacity refuses explicitly instead of stranding.
      if (owned === "busy")
        send({
          kind: "result",
          nonce,
          requestId: message.requestId,
          ok: false,
          revision,
          reason: "busy",
        });
      return;
    }
    const request = message;
    serial = serial.then(async () => {
      try {
        if (disposed || failed || lifecycle === null || native === null || captures === null)
          throw new Error("Office frame is not ready.");
        const { revision: confirmed, ...extra } = await performFrameOperation(
          request,
          native,
          lifecycle,
          captures,
          revision,
        );
        revision = confirmed;
        if (disposed || failed) throw new Error("Office frame failed during native work.");
        send({ kind: "result", nonce, requestId: request.requestId, ok: true, revision, ...extra });
      } catch (cause) {
        if (disposed) return;
        const tagged = readNativeReason(cause);
        const reason = tagged?.reason ?? "native";
        reportFrameEvent({
          service: "office-frame",
          operation: "frame.request",
          phase: tagged?.phase ?? (request.action === "flush" ? "flush" : "input"),
          reason,
          release,
          associationId: request.requestId,
        });
        if (!reason.startsWith("capture-")) status("error");
        send({
          kind: "result",
          nonce,
          requestId: request.requestId,
          ok: false,
          revision,
          reason: wireResultReason(reason),
        });
      }
      operations.settle(request.requestId);
      return;
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", receive);
    clearFrameErrors();
    window.removeEventListener("pagehide", dispose);
    captures?.dispose();
    lifecycle?.dispose();
    native?.univer.dispose();
  };
  window.addEventListener("message", receive);
  const clearFrameErrors = bindFrameErrors(() => release);
  window.addEventListener("pagehide", dispose);
  send({ kind: "boot", nonce });
  return dispose;
}
