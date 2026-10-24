/// <reference types="vite/client" />
import { Schema } from "effect";
import { Count, View, decodeWireSync } from "@starter/office-contract";

const Nonce = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const RequestId = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
export const NativeTheme = Schema.Literals(["dark", "light"]);
export type NativeTheme = typeof NativeTheme.Type;
export const NativeUser = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  name: Schema.String.check(Schema.isMaxLength(120)),
});
export type NativeUser = typeof NativeUser.Type;
export const FrameInit = Schema.Struct({
  view: View,
  user: NativeUser,
  theme: NativeTheme,
  channelId: Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,96}$/)),
});
export type FrameInit = typeof FrameInit.Type;
export const FrameStatus = Schema.Literals([
  "loading",
  "read-only",
  "saved",
  "saving",
  "offline",
  "conflict",
  "holding",
  "held",
  "error",
]);
export type FrameStatus = typeof FrameStatus.Type;
const FRAME_PHASES = ["init", "snapshot", "render", "input", "flush", "ack", "cleanup"] as const;
export const FramePhase = Schema.Literals(FRAME_PHASES);
export type FramePhase = typeof FramePhase.Type;
const WIRE_REASONS = ["not-ready", "busy", "timeout", "native", "interrupted", "disposed"] as const;
export const FrameResultReason = Schema.Literals(WIRE_REASONS);
export type FrameResultReason = typeof FrameResultReason.Type;
const FRAME_REASONS = [
  ...WIRE_REASONS,
  "expired",
  "import",
  "decode",
  "theme-decode",
  "composing",
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
const Release = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]{1,96}$/));
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
export const FrameRequest = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("init"),
    nonce: Nonce,
    input: FrameInit,
    release: Schema.optional(Release),
  }),
  Schema.Struct({
    kind: Schema.Literal("request"),
    nonce: Nonce,
    requestId: RequestId,
    action: Schema.Literals(["hold", "flush", "resume"]),
  }),
  Schema.Struct({ kind: Schema.Literal("theme"), nonce: Nonce, theme: NativeTheme }),
  Schema.Struct({ kind: Schema.Literal("dispose"), nonce: Nonce }),
  Schema.Struct({ kind: Schema.Literal("stop-input"), nonce: Nonce }),
]);
export const FrameResponse = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("boot"), nonce: Nonce }),
  Schema.Struct({
    kind: Schema.Literal("status"),
    nonce: Nonce,
    status: FrameStatus,
    revision: Count,
  }),
  Schema.Struct({
    kind: Schema.Literal("result"),
    nonce: Nonce,
    requestId: RequestId,
    ok: Schema.Boolean,
    revision: Count,
    reason: Schema.optional(FrameResultReason),
  }),
]);
export type FrameRequest = typeof FrameRequest.Type;
export type FrameResponse = typeof FrameResponse.Type;
export const readFrameRequest = decodeWireSync(FrameRequest);
export const readFrameResponse = decodeWireSync(FrameResponse);
export const frameNonce = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
