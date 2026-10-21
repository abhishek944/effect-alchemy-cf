import { Schema } from "effect";
import { View } from "@starter/office-contract";
import { FrameInit, NativeTheme, frameNonce, readFrameResponse } from "./frame/messages.ts";
import type { FrameRequest, FrameStatus } from "./frame/messages.ts";

const sameView = Schema.toEquivalence(View);
const readView = Schema.decodeUnknownSync(View, { onExcessProperty: "error" });
const readTheme = Schema.decodeUnknownSync(NativeTheme);

export type OfficeSave = { readonly viewId: string; readonly revision: number };
export type OfficeEditorHandle = {
  hold(): Promise<OfficeSave>;
  flush(): Promise<OfficeSave>;
  prepareToLeave(): Promise<OfficeSave>;
  resume(): Promise<void>;
};
export function connectOfficeFrame(
  frame: HTMLIFrameElement,
  url: string,
  input: FrameInit,
  onStatus: (status: FrameStatus, revision: number) => void,
) {
  const address = new URL(url, location.href);
  if (
    address.origin !== location.origin ||
    !["http:", "https:"].includes(address.protocol) ||
    address.username ||
    address.password
  )
    throw new Error("Office frame must be served from the authenticated application origin.");
  const decoded = Schema.decodeUnknownSync(FrameInit, { onExcessProperty: "error" })(input);
  let bootstrap: FrameInit = {
    ...decoded,
    user: { ...decoded.user },
    view: { ...decoded.view, nativeTarget: { ...decoded.view.nativeTarget } },
  };
  const boundViewId = bootstrap.view.id;
  const nonce = frameNonce();
  address.hash = new URLSearchParams({ officeFrame: nonce }).toString();
  let disposed = false;
  let initialized = false;
  const awaiting = new Map<
    string,
    {
      resolve(value: OfficeSave): void;
      reject(error: Error): void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const send = (message: FrameRequest) => frame.contentWindow?.postMessage(message, address.origin);
  const init = () => {
    if (!disposed) send({ kind: "init", nonce, input: bootstrap });
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (disposed || event.source !== frame.contentWindow || event.origin !== address.origin) return;
    let response;
    try {
      response = readFrameResponse(event.data);
    } catch {
      return;
    }
    if (response.nonce !== nonce) return;
    if (response.kind === "boot") {
      init();
      return;
    }
    if (response.kind === "status") {
      if (response.status !== "loading" && response.status !== "error") initialized = true;
      onStatus(response.status, response.revision);
      return;
    }
    const waiting = awaiting.get(response.requestId);
    if (!waiting) return;
    awaiting.delete(response.requestId);
    clearTimeout(waiting.timer);
    if (response.ok) waiting.resolve({ viewId: boundViewId, revision: response.revision });
    else
      waiting.reject(new Error("Native input or saves remain unconfirmed. Keep the editor open."));
  };
  const request = (action: "hold" | "flush" | "resume") =>
    new Promise<OfficeSave>((resolve, reject) => {
      if (disposed || !initialized) {
        reject(new Error("Office editor is not ready."));
        return;
      }
      const requestId = crypto.randomUUID();
      const timer = setTimeout(() => {
        awaiting.delete(requestId);
        onStatus("error", 0);
        reject(new Error("Office save acknowledgement timed out. Keep the editor open."));
      }, 90_000);
      awaiting.set(requestId, { resolve, reject, timer });
      send({ kind: "request", nonce, requestId, action });
    });
  window.addEventListener("message", receive);
  frame.addEventListener("load", init);
  frame.src = address.href;
  const handle: OfficeEditorHandle = {
    hold: () => request("hold"),
    flush: () => request("flush"),
    prepareToLeave: () => request("hold"),
    resume: async () => {
      await request("resume");
    },
  };
  return {
    handle,
    renew(view: View) {
      if (disposed) throw new Error("Office frame disposed.");
      const next = readView(view);
      if (!sameView({ ...bootstrap.view, expiresAt: 0 }, { ...next, expiresAt: 0 }))
        throw new Error("Office view identity changed. Keep the existing editor open.");
      if (next.expiresAt <= bootstrap.view.expiresAt) return false;
      // Bootstrap hint only: no message, navigation, native state or server authority change.
      bootstrap = { ...bootstrap, view: { ...bootstrap.view, expiresAt: next.expiresAt } };
      return true;
    },
    theme(theme: NativeTheme) {
      if (disposed) return;
      const latest = readTheme(theme);
      if (latest === bootstrap.theme) return;
      bootstrap = { ...bootstrap, theme: latest };
      send({ kind: "theme", nonce, theme: latest });
    },
    dispose() {
      if (disposed) return;
      send({ kind: "dispose", nonce });
      disposed = true;
      window.removeEventListener("message", receive);
      frame.removeEventListener("load", init);
      for (const pending of awaiting.values()) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Office frame was disposed before confirmation."));
      }
      awaiting.clear();
    },
  };
}
