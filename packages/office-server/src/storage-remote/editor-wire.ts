import { Schema } from "effect";
import { ArtifactRef, Count, Digest, Id } from "@starter/office-contract";
import { NativeReceiptBinding } from "../ports/index.ts";
import { HostId, HostEpoch, hostMethod } from "./host-wire.ts";
import {
  HostEditorPermit,
  HostEditorLeaf,
  HostEditorObservation,
  HostJoinedChannel,
  HostEditorAdmissionResult,
} from "./editor-records.ts";

/** The exact seven agreed provider methods. Null means an acknowledged void, not a stub result. */
export const HostEditor = Object.freeze({
  join: hostMethod(
    "editor.join",
    Schema.Struct({ viewId: Id, until: HostEpoch }),
    HostJoinedChannel,
  ),
  revoke: hostMethod("editor.revoke", Schema.Struct({}), Schema.Null),
  admit: hostMethod(
    "editor.admit",
    Schema.Struct({
      submissionId: Id,
      turnId: HostId,
      sid: HostId,
      reqId: Count,
      client: Schema.Struct({ ...ArtifactRef.fields, kind: Schema.Literal("native-write") }),
    }),
    HostEditorAdmissionResult,
  ),
  stage: hostMethod(
    "editor.stage",
    Schema.Struct({
      permit: HostEditorPermit,
      leaf: HostEditorLeaf,
    }),
    HostEditorLeaf,
  ),
  prepare: hostMethod(
    "editor.prepare",
    Schema.Struct({
      permit: HostEditorPermit,
      writeId: Id,
      binding: NativeReceiptBinding,
    }),
    Schema.Struct({ writeId: Id, payloadDigest: Digest }),
  ),
  observe: hostMethod(
    "editor.observe",
    Schema.Struct({ permit: HostEditorPermit }),
    HostEditorObservation,
  ),
  release: hostMethod("editor.release", Schema.Struct({ permit: HostEditorPermit }), Schema.Null),
});
