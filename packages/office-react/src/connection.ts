import { Schema } from "effect";
import { View, type OfficeSheetSelection } from "@starter/office-contract";
import {
  FrameInit,
  HOST_MESSAGES,
  OfficeFrameError,
  frameBuild,
  NativeTheme,
  frameNonce,
  readFrameResponse,
  type FramePhase,
  type FrameStatus,
  type FrameRequest,
} from "./frame/messages.ts";
import { freezeNativeCapture, type NativeSelectionCapture } from "./capture.ts";
import { frameRequests } from "./frame-requests.ts";
const sameView = Schema.toEquivalence(View);
const readView = Schema.decodeUnknownSync(View, { onExcessProperty: "error" });
const readTheme = Schema.decodeUnknownSync(NativeTheme);
export type OfficeSave = {
  readonly viewId: string;
  readonly revision: number;
  /** Descriptive native selection captured by the same hold; absent on older frames. */
  readonly selection?: OfficeSheetSelection;
};
export type OfficeEditorHandle = {
  hold(): Promise<OfficeSave>;
  flush(): Promise<OfficeSave>;
  prepareToLeave(): Promise<OfficeSave>;
  stopInput(): void;
  resume(): Promise<void>;
  /** Returns a real ACK while held. Host checkpoints, validates, then conditionally resumes. */
  prepareCapture(capture: NativeSelectionCapture): Promise<OfficeSave>;
  validateCapture(capture: NativeSelectionCapture): Promise<void>;
  revealCapture(capture: NativeSelectionCapture): Promise<void>;
};
export function connectOfficeFrame(
  frame: HTMLIFrameElement,
  url: string,
  input: FrameInit,
  onStatus: (status: FrameStatus, revision: number) => void,
  onSelection?: (capture: NativeSelectionCapture) => void,
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
  const frameFailure = (
    phase: FramePhase,
    reason: string,
    requestId: string | null,
    operation = "frame.request",
  ): OfficeFrameError =>
    new OfficeFrameError(
      phase,
      reason,
      HOST_MESSAGES[reason] ?? "The Office frame request could not be completed.",
      requestId,
      boundViewId,
      operation,
    );
  const nonce = frameNonce();
  address.hash = new URLSearchParams({ officeFrame: nonce }).toString();
  let disposed = false;
  let initialized = false;
  let inputStopped = false;
  const send = (message: FrameRequest) => frame.contentWindow?.postMessage(message, address.origin);
  const requests = frameRequests({
    viewId: boundViewId,
    nonce,
    ready: () => !disposed && initialized,
    send,
    failure: frameFailure,
    onTimeout: () => onStatus("error", 0),
  });
  const request = requests.request.bind(requests);
  const init = () => {
    if (!disposed) {
      send({ kind: "init", nonce, input: bootstrap, release: frameBuild() });
      if (inputStopped) send({ kind: "stop-input", nonce });
    }
  };
  const receive = (event: MessageEvent<unknown>) => {
    if (disposed || event.source !== frame.contentWindow || event.origin !== address.origin) return;
    let response;
    try {
      response = readFrameResponse(event.data);
    } catch {
      // Untrusted foreign bytes stay silent; decoding them must not log or throw.
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
    if (response.kind === "selection") {
      const capture = freezeNativeCapture(response.capture);
      if (capture.viewId === boundViewId && capture.unitId === bootstrap.view.nativeTarget.unitId)
        onSelection?.(capture);
      return;
    }
    requests.accept(response);
  };
  window.addEventListener("message", receive);
  frame.addEventListener("load", init);
  frame.src = address.href;
  const handle: OfficeEditorHandle = {
    prepareCapture: (capture) => request("prepare-capture", freezeNativeCapture(capture)),
    validateCapture: async (capture) => {
      await request("validate-capture", freezeNativeCapture(capture));
    },
    revealCapture: async (capture) => {
      await request("reveal-capture", freezeNativeCapture(capture));
    },
    hold: () => request("hold"),
    flush: () => request("flush"),
    prepareToLeave: () => request("hold"),
    stopInput: () => {
      inputStopped = true;
      send({ kind: "stop-input", nonce });
    },
    resume: async () => {
      await request("resume");
    },
  };
  return {
    handle,
    renew(view: View) {
      if (disposed) throw new Error("Office frame disposed.");
      let next: View;
      try {
        next = readView(view);
      } catch {
        throw frameFailure("snapshot", "decode", null, "frame.snapshot");
      }
      if (!sameView({ ...bootstrap.view, expiresAt: 0 }, { ...next, expiresAt: 0 }))
        throw frameFailure("snapshot", "identity-changed", null, "frame.snapshot");
      if (next.expiresAt <= bootstrap.view.expiresAt) return false;
      // Bootstrap hint only: no message, navigation, native state or server authority change.
      bootstrap = { ...bootstrap, view: { ...bootstrap.view, expiresAt: next.expiresAt } };
      return true;
    },
    theme(theme: NativeTheme) {
      if (disposed) return;
      let latest: NativeTheme;
      try {
        latest = readTheme(theme);
      } catch {
        throw frameFailure("render", "theme-decode", null, "frame.theme");
      }
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
      requests.dispose();
    },
  };
}
