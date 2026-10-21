import { Schema } from "effect";
import { Count, Digest, Id, Label } from "@starter/office-contract";
import { OriginalActorClaims } from "@starter/office-server/ports";
import {
  HostEpoch,
  HostId,
  HostNativeAccess,
  HostUnitRecord,
  HostViewRecord,
  hostMethod,
} from "@starter/office-server/native-remote";

/** Actual public binary metadata the ORIGINAL private frame selected; Node headers never choose it. */
export const NativePrivateFile = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("upload"),
    input: Schema.Struct({
      operationId: Id,
      kind: Schema.Literals(["upload", "code"]),
      filename: Label,
      bytes: Count,
      digest: Schema.NullOr(Digest),
    }),
  }),
  Schema.Struct({ kind: Schema.Literal("download"), artifactId: Id }),
]);
export type NativePrivateFile = typeof NativePrivateFile.Type;
/** Worker-safe bootstrap metadata only. These schemas correlate, never authenticate a peer. */
export const NativePrivateResolution = Schema.Struct({
  invocationId: HostId,
  kind: Schema.Literals(["core", "protocol"]),
  actor: OriginalActorClaims,
  view: Schema.NullOr(HostViewRecord),
  unit: Schema.NullOr(HostUnitRecord),
  access: Schema.NullOr(HostNativeAccess),
  worktreeId: Schema.NullOr(HostId),
  editorId: Schema.NullOr(Id),
  channelId: Schema.NullOr(Id),
  deadline: HostEpoch,
  cleanupDeadline: HostEpoch,
  file: Schema.NullOr(NativePrivateFile),
});
export type NativePrivateResolution = typeof NativePrivateResolution.Type;
export const NativeJobExit = Schema.Struct({
  status: Schema.Literals(["exited", "cancelled", "timed-out", "output-limit"]),
  exitCode: Schema.NullOr(Schema.Int),
  cleanup: Schema.Literal("confirmed"),
});
export const NativePrivateFinished = Schema.Struct({
  kind: Schema.Literals(["http", "upgrade"]),
  clean: Schema.Boolean,
});
export const NativePrivateMember = Schema.Struct({
  memberId: HostId,
  userId: HostId,
  worktreeId: Schema.NullOr(HostId),
  unitId: Schema.NullOr(HostId),
});
export const NativePrivateSubmission = Schema.Struct({
  submissionId: Id,
  turnId: HostId,
  sid: HostId,
  reqId: Count,
});
/** Use the ACTUAL current callback channels; stored SDK ticket capsules only identify their original channel. */
export const NativeChannelMember = hostMethod(
  "channel.member",
  Schema.Struct({ ...NativePrivateMember.fields, channelId: Id }),
  Schema.Struct({ invocationId: HostId }),
);
export const NativeChannelSubmission = hostMethod(
  "channel.submission",
  Schema.Struct({ channelId: Id, memberId: HostId, sid: HostId, reqId: Count }),
  NativePrivateSubmission,
);
