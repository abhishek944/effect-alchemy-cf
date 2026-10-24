import { Schema } from "effect";
import { Count, Digest, Id } from "@starter/office-contract";
import { HostEpoch, HostId, HostPermit, HostTarget, hostMethod } from "./host-wire.ts";
import { HostEditorPermit } from "./editor-records.ts";

export const HostSerialAdmission = Schema.Struct({
  operationId: Id,
  expectedHead: Schema.NullOr(Count),
  reviewFingerprint: Schema.NullOr(Digest),
  purpose: Schema.Literals(["native", "metadata", "proof"]),
});
export const HostTurnGrant = Schema.Struct({
  turnId: HostId,
  version: HostEpoch,
  fence: HostEpoch,
  deadline: HostEpoch,
  notAfter: HostEpoch,
  permit: HostPermit,
}).check(Schema.makeFilter((value) => value.deadline <= value.notAfter));
export const HostNativeAccess = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("read"),
    target: HostTarget,
    authorityEpoch: HostEpoch,
    serviceEpoch: HostEpoch,
  }),
  Schema.Struct({ kind: Schema.Literal("write"), permit: HostPermit }),
  Schema.Struct({ kind: Schema.Literal("editor"), permit: HostEditorPermit }),
]);
export const HostTurn = Object.freeze({
  acquire: hostMethod(
    "turn.acquire",
    Schema.Struct({
      attemptId: HostId,
      target: HostTarget,
      admission: HostSerialAdmission,
    }),
    HostTurnGrant,
  ),
  release: hostMethod(
    "turn.release",
    Schema.Struct({
      turnId: HostId,
      expectedVersion: HostEpoch,
    }),
    Schema.Struct({
      turnId: HostId,
      version: HostEpoch,
      state: Schema.Literals(["held", "released", "expired"]),
    }),
  ),
});
export const HostNativeHandles = Object.freeze({
  open: hostMethod(
    "native.open",
    Schema.Struct({ access: HostNativeAccess }),
    Schema.Struct({
      handleId: HostId,
      worktreeId: Schema.NullOr(HostId),
      baselineRevision: Schema.NullOr(Count),
      deadline: HostEpoch,
    }),
  ),
  close: hostMethod("native.close", Schema.Struct({ handleId: HostId }), Schema.Null),
});
