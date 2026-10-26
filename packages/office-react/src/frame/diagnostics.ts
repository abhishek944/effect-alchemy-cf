/// <reference types="vite/client" />
import { Schema } from "effect";

const FRAME_PHASES = ["init", "snapshot", "render", "input", "flush", "ack", "cleanup"] as const;
export const FramePhase = Schema.Literals(FRAME_PHASES);
export type FramePhase = typeof FramePhase.Type;
const WIRE_REASONS = [
  "not-ready",
  "busy",
  "timeout",
  "native",
  "interrupted",
  "disposed",
  "capture-changed",
  "capture-unavailable",
  "capture-unsupported",
  "composing",
] as const;
export const FrameResultReason = Schema.Literals(WIRE_REASONS);
export type FrameResultReason = typeof FrameResultReason.Type;
const FRAME_REASONS = [
  ...WIRE_REASONS,
  "expired",
  "import",
  "decode",
  "theme-decode",
  "unacknowledged",
  "revision-unavailable",
  "identity-changed",
  "window-error",
  "unhandled-rejection",
];
const isFrameReason = (value: unknown): value is string =>
  FRAME_REASONS.some((reason) => reason === value);
const isResultReason = (value: unknown): value is FrameResultReason =>
  WIRE_REASONS.some((reason) => reason === value);
/** Narrow an internal reason to the wire-safe result classification. */
export function wireResultReason(reason: string): FrameResultReason {
  return isResultReason(reason) ? reason : "native";
}
/** Read a parent-reported result reason; foreign values become unclassified native. */
export function readResultReason(value: unknown): FrameResultReason {
  return isResultReason(value) ? value : "native";
}
export const HOST_MESSAGES: Record<string, string> = {
  composing: "Finish composing native text before adding context or leaving.",
  "capture-changed": "Native content changed. Select the context again.",
  "capture-unavailable":
    "The captured native scope is unavailable. Show its source and select again.",
  "capture-unsupported": "This native selection cannot be captured exactly.",
  "not-ready": "Office editor is not ready.",
  busy: "The Office frame is busy with other work. Retry this action.",
  timeout: "Office save acknowledgement timed out. Keep the editor open.",
  native: "Native input or saves remain unconfirmed. Keep the editor open.",
  interrupted: "Native input or saves remain unconfirmed. Keep the editor open.",
  disposed: "Office frame was disposed before confirmation.",
  decode: "Office view identity changed. Keep the existing editor open.",
  "theme-decode": "Office theme could not be applied.",
  "identity-changed": "Office view identity changed. Keep the existing editor open.",
};
export function frameBuild(): string {
  const raw: unknown = import.meta.env?.VITE_APP_VERSION;
  return typeof raw === "string" && /^[A-Za-z0-9_.-]{1,96}$/.test(raw) ? raw : "dev";
}
/**
 * Local frame/host event record only; the console is the sink. Never pass the
 * channel nonce, user objects, content, URLs, credentials, or raw SDK errors.
 */
export function reportFrameEvent(input: {
  service: "office-host" | "office-frame";
  operation: string;
  phase: FramePhase;
  reason: string;
  associationId?: string | null | undefined;
  release?: string | undefined;
}): void {
  const record: Record<string, string> = {
    timestamp: new Date().toISOString(),
    level: "ERROR",
    event: "application.failure",
    service: input.service,
    release: input.release ?? frameBuild(),
    component: input.service,
    operation: /^frame\.(?:init|request|snapshot|theme|host)$/.test(input.operation)
      ? input.operation
      : "frame.request",
    phase: input.phase,
    reason: isFrameReason(input.reason) ? input.reason : "native",
  };
  if (
    typeof input.associationId === "string" &&
    /^(?:[A-Za-z0-9_-]{16,96}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/.test(
      input.associationId,
    )
  )
    record.association_id = input.associationId;
  console.error(JSON.stringify(record));
}
/** Report an unattributable host-level failure; document failures keep their own paths. */
export const reportHostFailure = (release: string | undefined, reason: string) =>
  reportFrameEvent({
    service: "office-frame",
    operation: "frame.host",
    phase: "render",
    reason,
    release,
  });
export class OfficeFrameError extends Error {
  readonly phase: FramePhase;
  readonly reason: string;
  readonly requestId: string | null;
  readonly viewId: string;
  constructor(
    phase: FramePhase,
    reason: string,
    message: string,
    requestId: string | null,
    viewId: string,
    operation = "frame.request",
  ) {
    super(requestId === null ? message : `${message} (ref ${requestId})`);
    this.name = "OfficeFrameError";
    this.phase = phase;
    this.reason = reason;
    this.requestId = requestId;
    this.viewId = viewId;
    reportFrameEvent({
      service: "office-host",
      operation,
      phase,
      reason,
      associationId: requestId ?? viewId,
    });
  }
}

export function bindFrameErrors(release: () => string | undefined) {
  // An unattributable global failure is reported, not treated as proof that this document
  // is unusable. Load, input and save failures keep their own terminal, request-scoped paths.
  const onWindowError = () => reportHostFailure(release(), "window-error");
  const onWindowRejection = (event: PromiseRejectionEvent) => {
    if (event.reason instanceof DOMException && event.reason.name === "AbortError") return;
    reportHostFailure(release(), "unhandled-rejection");
  };
  window.addEventListener("error", onWindowError);
  window.addEventListener("unhandledrejection", onWindowRejection);
  return () => {
    window.removeEventListener("error", onWindowError);
    window.removeEventListener("unhandledrejection", onWindowRejection);
  };
}
