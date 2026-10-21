import { Schema } from "effect";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import { Count, Digest, Id, Revision, decodeWireSync } from "@starter/office-contract";
import { NativeReceiptBinding, NativeReceiptKey } from "../ports/native-receipts.ts";

/** Private broker DTOs only. Type-only SDK imports belong at Node adapters, never Worker content decode. */
const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const Positive = Count.check(Schema.isGreaterThanOrEqualTo(1));
export const NativePiece = Schema.Struct({
  key: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512)),
  digest: Digest,
  bytes: Positive.check(Schema.isLessThanOrEqualTo(4 * 1024 * 1024)),
});
export const NativeValue = Schema.Struct({
  codec: Schema.Literal(NATIVE_WIRE_CODEC),
  kind: Schema.Literals(["snapshot", "block", "changeset"]),
  bytes: Positive.check(Schema.isLessThanOrEqualTo(128 * 1024 * 1024)),
  parts: Schema.Array(NativePiece).check(Schema.isMinLength(1), Schema.isMaxLength(32)),
});
export type NativeValue = typeof NativeValue.Type;
export const NativeSnapshot = Schema.Struct({
  unitID: NativeId,
  type: Schema.Literals([1, 2, 3]),
  revision: Revision,
  snapshot: NativeValue,
  blocks: Schema.Array(
    Schema.Struct({
      blockID: NativeId,
      value: NativeValue,
    }),
  ).check(Schema.isMaxLength(4096)),
});
export type NativeSnapshot = typeof NativeSnapshot.Type;
export const NativeChange = Schema.Struct({
  unitID: NativeId,
  type: Schema.Literals([1, 2, 3]),
  baseRev: Revision,
  revision: Revision,
  sid: Schema.NullOr(NativeId),
  reqId: Schema.NullOr(Count),
  value: NativeValue,
});
export type NativeChange = typeof NativeChange.Type;
/** A completed piece is NOT a read capability: broker verifies published reachability for this origin. */
export const PublishedOrigin = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), revision: Revision }),
  Schema.Struct({ kind: Schema.Literal("seed"), worktreeID: NativeId }),
  Schema.Struct({
    kind: Schema.Literal("merge-artifact"),
    worktreeID: NativeId,
    readyRevision: Revision,
  }),
  Schema.Struct({
    kind: Schema.Literal("changeset"),
    branch: Schema.String.check(Schema.isMaxLength(256)),
    revision: Revision,
  }),
]);
export type PublishedOrigin = typeof PublishedOrigin.Type;
export const NativeProducer = Schema.Struct({
  operationId: Id,
  stepId: NativeId,
  unitID: NativeId,
  type: Schema.Literals([1, 2, 3]),
  revision: Revision,
  policyVersion: NativeId,
  sdkVersion: Schema.Literal("1.0.3"),
  imageDigest: NativeId,
  contentDigest: Digest,
  source: Schema.Literals(["sdk-create", "sdk-submit", "sdk-snapshot", "sdk-merge"]),
});
export type NativeProducer = typeof NativeProducer.Type;
export const NativeReadRequest = Schema.Union([
  Schema.Struct({ method: Schema.Literal("snapshot"), revision: Revision }),
  Schema.Struct({ method: Schema.Literal("seed"), worktreeId: NativeId, generation: Count }),
  Schema.Struct({
    method: Schema.Literal("merge-artifact"),
    worktreeId: NativeId,
    generation: Count,
    readyRevision: Revision,
  }),
  Schema.Struct({
    method: Schema.Literal("changesets"),
    worktreeId: Schema.NullOr(NativeId),
    from: Count,
    to: Revision,
    cursor: Schema.NullOr(NativeId),
  }),
  Schema.Struct({
    method: Schema.Literal("submission"),
    worktreeId: Schema.NullOr(NativeId),
    sid: NativeId,
    reqId: Count,
  }),
  Schema.Struct({
    method: Schema.Literal("step-receipt"),
    operationId: Id,
    stepId: NativeId,
    writeId: Id,
    payloadDigest: Digest,
    receipt: NativeReceiptKey,
    expected: NativeReceiptBinding,
  }),
]);
export type NativeReadRequest = typeof NativeReadRequest.Type;
export const NativePartRequest = Schema.Struct({
  origin: PublishedOrigin,
  valueDigest: Digest,
  part: Count.check(Schema.isLessThanOrEqualTo(31)),
});
export type NativePartRequest = typeof NativePartRequest.Type;
export function validateNativeValueRef(input: unknown): NativeValue {
  const ref = decodeWireSync(NativeValue)(input);
  if (
    ref.parts.reduce((total, part) => total + part.bytes, 0) !== ref.bytes ||
    ref.parts.some((part, index) => index < ref.parts.length - 1 && part.bytes !== 4 * 1024 * 1024)
  )
    throw new Error("Invalid native value part lengths");
  return ref;
}
/** Finite reference tuple, not canonicalization of any native document. Both runtimes use WebCrypto. */
export async function nativeValueDigest(input: NativeValue): Promise<string> {
  const value = validateNativeValueRef(input);
  const bytes = new TextEncoder().encode(
    JSON.stringify([
      value.codec,
      value.kind,
      value.bytes,
      value.parts.map((part) => [part.key, part.digest, part.bytes]),
    ]),
  );
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (n) => n.toString(16).padStart(2, "0")).join("");
}
