import { Schema } from "effect";
import { Digest, Id, Revision } from "@starter/office-contract";
import { HostId, HostPolicy } from "./host-wire.ts";
import { NativeProducer, NativeSnapshot } from "./wire.ts";

/** SDK process/request association must attest these claims independently of decoding. */
export const HostEditorProducer = Schema.Struct({
  kind: Schema.Literal("editor"),
  submissionId: Id,
  stepId: HostId,
  unitID: HostId,
  type: NativeSnapshot.fields.type,
  revision: Revision,
  policyVersion: HostId,
  sdkVersion: Schema.Literal("1.0.3"),
  imageDigest: HostPolicy.fields.imageDigest,
  contentDigest: Digest,
  source: Schema.Literal("sdk-submit"),
});
export type HostEditorProducer = typeof HostEditorProducer.Type;
/** Never encode a native editor submissionId as a Core business operationId. */
export const HostNativeProducer = Schema.Union([NativeProducer, HostEditorProducer]);
export type HostNativeProducer = typeof HostNativeProducer.Type;
