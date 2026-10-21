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
export const FrameRequest = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("init"), nonce: Nonce, input: FrameInit }),
  Schema.Struct({
    kind: Schema.Literal("request"),
    nonce: Nonce,
    requestId: RequestId,
    action: Schema.Literals(["hold", "flush", "resume"]),
  }),
  Schema.Struct({ kind: Schema.Literal("theme"), nonce: Nonce, theme: NativeTheme }),
  Schema.Struct({ kind: Schema.Literal("dispose"), nonce: Nonce }),
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
