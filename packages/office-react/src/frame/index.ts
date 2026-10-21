import { createNativeApplication, loadNativeView } from "./native.ts";
import { nativeLifecycle } from "./lifecycle.ts";
import { readFrameRequest, type FrameResponse } from "./messages.ts";
import { confirmNativeRendering } from "./rendering.ts";

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
  let revision = 0;
  let serial = Promise.resolve();
  const seen = new Set<string>();
  const send = (message: FrameResponse) => {
    if (!disposed) window.parent.postMessage(message, origin);
  };
  const status = (value: "loading" | "error") =>
    send({ kind: "status", nonce, status: value, revision });
  const fail = () => {
    if (disposed) return;
    failed = true;
    container.inert = true;
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
    if (message.kind === "init") {
      if (initialized) return;
      initialized = true;
      const input = message.input;
      if (input.view.expiresAt <= Date.now()) {
        status("error");
        return;
      }
      status("loading");
      container.inert = true;
      serial = (async () => {
        if (input.view.nativeTarget.kind !== "pinned-snapshot")
          await import("@univerjs-pro/collaboration-client/facade");
        if (input.view.kind === "slide") await import("@univerjs-pro/slides/facade");
        native = createNativeApplication(
          container,
          input.view.kind,
          input.theme,
          input.user,
          input,
        );
        await loadNativeView(native, input);
        await confirmNativeRendering(
          native.injector,
          input.view.kind,
          input.view.nativeTarget.unitId,
        );
        if (disposed || failed) return;
        lifecycle = nativeLifecycle(native, input, (state, confirmed) => {
          revision = confirmed;
          send({ kind: "status", nonce, status: state, revision });
        });
        container.inert = false;
      })().catch(() => {
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
    if (seen.has(message.requestId) || seen.size >= 1024) return;
    seen.add(message.requestId);
    const request = message;
    serial = serial.then(async () => {
      try {
        if (disposed || failed || lifecycle === null) throw new Error("Office frame is not ready.");
        if (request.action === "resume") lifecycle.resume();
        else revision = await lifecycle[request.action]();
        if (disposed || failed) throw new Error("Office frame failed during native work.");
        send({ kind: "result", nonce, requestId: request.requestId, ok: true, revision });
      } catch {
        status("error");
        send({ kind: "result", nonce, requestId: request.requestId, ok: false, revision });
      }
      return;
    });
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("message", receive);
    window.removeEventListener("error", fail);
    window.removeEventListener("unhandledrejection", fail);
    window.removeEventListener("pagehide", dispose);
    lifecycle?.dispose();
    native?.univer.dispose();
  };
  window.addEventListener("message", receive);
  window.addEventListener("error", fail);
  window.addEventListener("unhandledrejection", fail);
  window.addEventListener("pagehide", dispose);
  send({ kind: "boot", nonce });
  return dispose;
}
