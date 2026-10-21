import { Schema } from "effect";
import { ArtifactRef, Count, Digest, Id, Revision } from "@starter/office-contract";
import { NativeReceiptBinding } from "../ports/index.ts";
import { HostEpoch, HostId, HostTarget } from "./host-wire.ts";
import { NativeChange } from "./wire.ts";

/** Captured real native turn identity, not a credential or a constructor-selected grant. */
export const HostNativeAdmission = Schema.Struct({
  turnId: HostId,
  fence: HostEpoch,
  authorizationDigest: Digest,
  notAfter: HostEpoch,
});
export const HostEditorPermit = Schema.Struct({
  target: HostTarget,
  authorityEpoch: HostEpoch,
  serviceEpoch: HostEpoch,
  submissionId: Id,
  stepId: HostId,
  channelId: HostId,
  editorId: Id,
  editorEpoch: HostEpoch,
  memberId: HostId,
  sid: HostId,
  reqId: Count,
  expectedHead: Revision,
});
export const HostEditorLeaf = Schema.Struct({
  id: Id,
  submissionId: Id,
  payload: Schema.Struct({ ...ArtifactRef.fields, kind: Schema.Literal("native-write") }),
  receipt: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("main-change"), revision: Revision }),
    Schema.Struct({
      kind: Schema.Literal("draft-change"),
      worktreeId: HostId,
      revision: Revision,
    }),
  ]),
  committed: NativeChange,
}).check(Schema.makeFilter((leaf) => leaf.receipt.revision === leaf.committed.revision));
export const HostEditorObservation = Schema.Union([
  Schema.Struct({ state: Schema.Literal("unknown") }),
  Schema.Struct({
    state: Schema.Literal("confirmed"),
    binding: NativeReceiptBinding,
    acceptedRevision: Revision,
    committed: NativeChange,
  }).check(Schema.makeFilter((value) => value.acceptedRevision === value.committed.revision)),
]);
export const HostJoinedChannel = Schema.Struct({
  id: HostId,
  viewId: Id,
  editorId: Id,
  editorEpoch: HostEpoch,
  until: HostEpoch,
  version: HostEpoch,
  state: Schema.Literals(["live", "revoked"]),
});
export const HostEditorAdmissionResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("admitted"),
    permit: HostEditorPermit,
    admission: HostNativeAdmission,
  }),
  Schema.Struct({ kind: Schema.Literal("observed"), observation: HostEditorObservation }),
]);
export type HostEditorAdmissionResult = typeof HostEditorAdmissionResult.Type;
export type HostJoinedChannel = typeof HostJoinedChannel.Type;
