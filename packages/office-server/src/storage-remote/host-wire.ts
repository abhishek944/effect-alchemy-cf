import { Schema } from "effect";
import { Count, Digest, DocumentScope, Failure, Id, OfficeLimits } from "@starter/office-contract";
import {
  OwnerClaims,
  OriginalActorClaims,
  NativeReceiptKey,
  NativeReceiptBinding,
} from "../ports/index.ts";

export const HostId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const HostEpoch = Count.check(Schema.isGreaterThanOrEqualTo(1));
export const HostPolicy = Schema.Struct({
  version: HostId,
  sdkVersion: Schema.Literal("1.0.3"),
  imageDigest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  limits: OfficeLimits,
});
export const HostTarget = Schema.Struct({
  owner: OwnerClaims,
  documentId: Id,
  unitId: HostId,
  scope: DocumentScope,
});
export const HostPermit = Schema.Struct({
  owner: OwnerClaims,
  documentId: Id,
  operationId: Id,
  stepId: HostId,
  authorityEpoch: HostEpoch,
  serviceEpoch: HostEpoch,
  target: HostTarget,
  expectedHead: Schema.NullOr(Count),
  expectedGeneration: Schema.NullOr(Count),
  reviewFingerprint: Schema.NullOr(Digest),
});
export const HostActorVerification = Schema.Union([
  Schema.Struct({
    claims: OriginalActorClaims,
    phase: Schema.Literal("request"),
    operationId: Schema.NullOr(Id),
    intentDigest: Schema.NullOr(Digest),
    target: Schema.NullOr(HostTarget),
  }),
  Schema.Struct({
    claims: OriginalActorClaims,
    phase: Schema.Literals(["final-commit", "recovery-observe", "recovery-dispatch"]),
    operationId: Id,
    intentDigest: Digest,
    target: HostTarget,
  }),
]);
export const HostReceiptRequest = Schema.Struct({
  target: HostTarget,
  operationId: Id,
  stepId: HostId,
  writeId: Id,
  payloadDigest: Digest,
  receipt: NativeReceiptKey,
  expected: NativeReceiptBinding,
});
export const HostReceiptResult = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unknown") }),
  Schema.Struct({
    state: Schema.Literal("confirmed"),
    fingerprint: Digest,
    authorityEpoch: HostEpoch,
    acceptedRevision: Schema.NullOr(Count),
  }),
]);
/** Schemas only: this finite descriptor never dispatches a method or executes a closure. */
export function hostMethod<
  const M extends string,
  Q extends Schema.Constraint,
  A extends Schema.Constraint,
>(method: M, input: Q, value: A) {
  return Object.freeze({
    method,
    request: Schema.Struct({ method: Schema.Literal(method), input }),
    response: Schema.Union([
      Schema.Struct({ method: Schema.Literal(method), value }),
      Schema.Struct({ method: Schema.Literal(method), error: Failure }),
    ]),
  });
}
/** IDs correlate a real private association; decoding is NEVER authentication. */
export function hostEnvelope<S extends Schema.Constraint>(payload: S) {
  return Schema.Struct({
    version: Schema.Literal(1),
    invocationId: HostId,
    callId: Id,
    payload,
  });
}
export const HostControl = Object.freeze({
  current: hostMethod(
    "authority.current",
    Schema.Struct({
      owner: OwnerClaims,
      documentId: Id,
    }),
    Schema.Struct({ authorityEpoch: HostEpoch, serviceEpoch: HostEpoch }),
  ),
  verifyActor: hostMethod("actor.verify", HostActorVerification, Schema.Null),
  observeReceipt: hostMethod("receipt.observe", HostReceiptRequest, HostReceiptResult),
});
