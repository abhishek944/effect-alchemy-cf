/// <reference types="vite/client" />
import { Schema } from "effect";
import { Count, OfficeSheetSelection, View, decodeWireSync } from "@starter/office-contract";

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
export {
  FramePhase,
  FrameResultReason,
  HOST_MESSAGES,
  OfficeFrameError,
  frameBuild,
  readResultReason,
  reportFrameEvent,
  reportHostFailure,
  wireResultReason,
} from "./diagnostics.ts";
import { FrameResultReason } from "./diagnostics.ts";
import { NativeSelectionCaptureSchema } from "../capture.ts";
const Release = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_.-]{1,96}$/));
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
  Schema.Struct({
    kind: Schema.Literal("request"),
    nonce: Nonce,
    requestId: RequestId,
    action: Schema.Literals(["prepare-capture", "validate-capture", "reveal-capture"]),
    capture: NativeSelectionCaptureSchema,
  }),
  Schema.Struct({ kind: Schema.Literal("theme"), nonce: Nonce, theme: NativeTheme }),
  Schema.Struct({ kind: Schema.Literal("dispose"), nonce: Nonce }),
  Schema.Struct({ kind: Schema.Literal("stop-input"), nonce: Nonce }),
]);
export const FrameResponse = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("boot"), nonce: Nonce }),
  Schema.Struct({
    kind: Schema.Literal("selection"),
    nonce: Nonce,
    capture: NativeSelectionCaptureSchema,
  }),
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
    /** Descriptive native selection captured by a hold; absent on older frames and non-sheets. */
    selection: Schema.optionalKey(OfficeSheetSelection),
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
