import { Schema } from "effect";
import { ArtifactRef, Count, Digest, Id, Revision } from "@starter/office-contract";
import type { NativeReceiptBinding } from "@starter/office-server/ports";
import type {
  NativeEditorLeaf,
  NativeEditorObservation,
  NativeEditorPermit,
  Store,
} from "@starter/office-server/ports";
import { NativeChange } from "@starter/office-server/native-remote";
import type { NativeAdmission } from "../native/types.ts";
import type { VerifiedCoordinatorContext } from "./coordinator/types.ts";
import { NativeId, Permit } from "./schemas.ts";

export type EditorContext = Extract<VerifiedCoordinatorContext, { kind: "editor" }>;
const Positive = Count.check(Schema.isGreaterThanOrEqualTo(1));
export const EditorPermit = Schema.Struct({
  target: Permit.fields.target,
  authorityEpoch: Positive,
  serviceEpoch: Positive,
  submissionId: Id,
  stepId: NativeId,
  channelId: Id,
  editorId: Id,
  editorEpoch: Positive,
  memberId: NativeId,
  sid: NativeId,
  reqId: Count,
  expectedHead: Revision,
});
export const EditorLeaf = Schema.Struct({
  id: Id,
  submissionId: Id,
  payload: Schema.Struct({ ...ArtifactRef.fields, kind: Schema.Literal("native-write") }),
  receipt: Schema.Union([
    Schema.Struct({ kind: Schema.Literal("main-change"), revision: Revision }),
    Schema.Struct({
      kind: Schema.Literal("draft-change"),
      worktreeId: NativeId,
      revision: Revision,
    }),
  ]),
  committed: NativeChange,
});
export const Client = Schema.Struct({
  sid: NativeId,
  reqId: Count,
  client: Schema.Struct({ ...ArtifactRef.fields, kind: Schema.Literal("native-write") }),
});
export const Channel = Schema.Struct({
  id: Id,
  viewId: Id,
  editorId: Id,
  editorEpoch: Positive,
  until: Positive,
  version: Positive,
  state: Schema.Literals(["live", "revoked"]),
  target: Permit.fields.target,
  principalId: NativeId,
  sessionEpoch: Count,
  memberId: NativeId,
  placementId: Id,
  authorityEpoch: Positive,
  serviceEpoch: Positive,
});
export const EditorTurn = Schema.Struct({
  id: Id,
  version: Positive,
  fence: Positive,
  state: Schema.Literals(["held", "released", "expired"]),
  mode: Schema.Literal("native"),
  deadline: Positive,
  authNotAfter: Positive,
  authorizationDigest: Digest,
  placementId: Id,
  principalId: NativeId,
  sessionEpoch: Count,
  target: Permit.fields.target,
  origin: EditorPermit,
});
export const Submission = Schema.Struct({
  id: Id,
  scope: Schema.String,
  branch: Schema.String,
  sid: NativeId,
  req_id: Count,
  channel_id: Id,
  editor_id: Id,
  editor_epoch: Positive,
  turn_id: Id,
  state: Schema.Literals(["admitted", "staged", "prepared", "confirmed", "unknown", "rejected"]),
  client_ref: Schema.String,
  leaf_record: Schema.NullOr(Schema.String),
  prepared_record: Schema.NullOr(Schema.String),
  accepted_revision: Schema.NullOr(Revision),
});
export type JoinedChannel = Pick<
  typeof Channel.Type,
  "id" | "viewId" | "editorId" | "editorEpoch" | "until" | "version" | "state"
>;
export type EditorAdmissionResult =
  | {
      readonly kind: "admitted";
      readonly permit: NativeEditorPermit;
      readonly admission: NativeAdmission;
    }
  | { readonly kind: "observed"; readonly observation: NativeEditorObservation };
export interface NativeEditorAdmission {
  join(viewId: string, until: number): Store<JoinedChannel>;
  revoke(): Store<void>;
  admit(
    submissionId: string,
    turnId: string,
    client: { readonly sid: string; readonly reqId: number; readonly client: ArtifactRef },
  ): Store<EditorAdmissionResult>;
  stage(permit: NativeEditorPermit, leaf: NativeEditorLeaf): Store<NativeEditorLeaf>;
  prepare(
    permit: NativeEditorPermit,
    writeId: string,
    binding: NativeReceiptBinding,
  ): Store<{ readonly writeId: string; readonly payloadDigest: string }>;
  observe(permit: NativeEditorPermit): Store<NativeEditorObservation>;
  release(permit: NativeEditorPermit): Store<void>;
}
