import "../frame/native.css";
import { mountOfficeFrame } from "../frame/index.ts";
import { readFrameRequest } from "../frame/messages.ts";

// Passive artifact observation; the actual production mounter alone handles initialization.
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (event.origin !== location.origin || event.source !== window.parent) return;
  try {
    const message = readFrameRequest(event.data);
    const nonce = new URLSearchParams(location.hash.slice(1)).get("officeFrame");
    if (message.kind !== "init" || message.nonce !== nonce) return;
    const data = document.documentElement.dataset;
    data.officeProbeView = message.input.view.id;
    data.officeProbeUnit = message.input.view.nativeTarget.unitId;
    data.officeProbeExpiry = String(message.input.view.expiresAt);
    data.officeProbeTheme = message.input.theme;
  } catch {
    /* Invalid metadata is not evidence and grants nothing. */
  }
});
const container = document.getElementById("office-native");
if (container === null) throw new Error("Actual native frame root missing.");
mountOfficeFrame(container);
