import { Schema } from "effect";
import { Count, Digest, Id } from "@starter/office-contract";
import { OwnerClaims } from "@starter/office-server/ports";
import { NativeId, Permit } from "../schemas.ts";

export const Positive = Count.check(Schema.isGreaterThanOrEqualTo(1));
export const Target = Permit.fields.target;
export const DocumentKeySchema = Schema.Struct({
  owner: OwnerClaims,
  documentId: Id,
  unitId: NativeId,
});
export const CoreBindingSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("operation"),
    operationId: Id,
    intentDigest: Digest,
    lineageDigest: Digest,
  }),
  Schema.Struct({
    kind: Schema.Literal("new-merge"),
    operationId: Id,
    approvalOperationId: Id,
    principalId: NativeId,
    sessionEpoch: Count,
    reviewFingerprint: Digest,
  }),
]);
export const Admission = Schema.Struct({
  operationId: Id,
  expectedHead: Schema.NullOr(Count),
  reviewFingerprint: Schema.NullOr(Digest),
  purpose: Schema.Literals(["native", "metadata", "proof"]),
});
const Base = { document: DocumentKeySchema, authorizationDigest: Digest, notAfter: Positive };
export const VerifiedContext = Schema.Union([
  Schema.Struct({ ...Base, kind: Schema.Literal("placement"), nodeId: NativeId }),
  Schema.Struct({
    ...Base,
    kind: Schema.Literal("core"),
    target: Target,
    binding: CoreBindingSchema,
    placementId: Id,
    purpose: Admission.fields.purpose,
  }),
  Schema.Struct({
    ...Base,
    kind: Schema.Literal("editor"),
    target: Target,
    channelId: Id,
    placementId: Id,
    editorId: Id,
    editorEpoch: Positive,
    principalId: NativeId,
    sessionEpoch: Count,
    memberId: NativeId,
  }),
  Schema.Struct({ ...Base, kind: Schema.Literal("read"), target: Target, viewId: Id }),
]);
export const PlacementSchema = Schema.Struct({
  ...DocumentKeySchema.fields,
  id: Id,
  nodeId: NativeId,
  authorityEpoch: Positive,
  serviceEpoch: Positive,
  until: Positive,
  state: Schema.Literals(["live", "retired"]),
});
export const PlacementChangeSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("claim"),
    id: Id,
    nodeId: NativeId,
    expectedServiceEpoch: Schema.NullOr(Count),
    until: Positive,
  }),
  Schema.Struct({ kind: Schema.Literal("renew"), id: Id, serviceEpoch: Positive, until: Positive }),
  Schema.Struct({ kind: Schema.Literal("retire"), id: Id, serviceEpoch: Positive }),
]);
export const TurnSchema = Schema.Struct({
  id: Id,
  version: Positive,
  fence: Positive,
  target: Target,
  placementId: Id,
  commandId: Id,
  stepId: NativeId,
  authorityEpoch: Positive,
  serviceEpoch: Positive,
  deadline: Positive,
  authNotAfter: Positive,
  mode: Admission.fields.purpose,
  state: Schema.Literals(["held", "released", "expired"]),
  origin: CoreBindingSchema,
  authorizationDigest: Digest,
  admission: Admission,
  nativePlan: Schema.NullOr(Schema.Literals(["fresh", "ready-capture", "newborn-unit"])),
});
export const TurnChangeSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("renew"), until: Positive }),
  Schema.Struct({ kind: Schema.Literal("release") }),
]);
