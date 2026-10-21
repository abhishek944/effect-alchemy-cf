import { createHash } from "node:crypto";
import type { IChangeset } from "@univerjs/protocol";
import {
  decodeWireSync,
  OfficeForbidden,
  OfficeLimited,
  safeFailure,
} from "@starter/office-contract";
import { encodeNativeFrame, NATIVE_WIRE_LIMITS } from "@starter/office-contract/native-wire";
import type { NativeEditorPermit, OfficeDependencies } from "../ports/index.ts";
import { decodeChangeset } from "./native-envelope.ts";
import { HostEditorPermit } from "./editor-records.ts";
import { HostPolicy } from "./host-wire.ts";
import { HostEditorProducer } from "./producer-wire.ts";
import type { HostValueHeader } from "./adapter-piece-wire.ts";

/** Actual transformed SDK commit only. These claims still require the real private issuer attestation. */
export function prepareSdkEditorCommit(
  input: IChangeset,
  original: NativeEditorPermit,
  configuration: OfficeDependencies["policy"],
  nativeType: IChangeset["type"],
) {
  const permit = decodeWireSync(HostEditorPermit)(original);
  const policy = decodeWireSync(HostPolicy)(configuration);
  if (
    input.unitID !== permit.target.unitId ||
    input.type !== nativeType ||
    input.userID !== permit.target.owner.ownerId ||
    input.memberID !== permit.memberId ||
    input.sid !== permit.sid ||
    input.reqId !== permit.reqId ||
    input.baseRev !== permit.expectedHead ||
    input.revision !== permit.expectedHead + 1
  )
    throw new OfficeForbidden(safeFailure("FORBIDDEN"));
  const maximum = Math.min(policy.limits.nativeBytes, NATIVE_WIRE_LIMITS.maxBytes);
  const bytes = encodeNativeFrame("changeset", input, { ...NATIVE_WIRE_LIMITS, maxBytes: maximum });
  if (bytes.byteLength > maximum) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  const change = decodeChangeset(bytes, {
    unitID: permit.target.unitId,
    type: nativeType,
    baseRev: permit.expectedHead,
    revision: permit.expectedHead + 1,
    sid: permit.sid,
    reqId: permit.reqId,
  });
  const producer = decodeWireSync(HostEditorProducer)({
    kind: "editor",
    submissionId: permit.submissionId,
    stepId: permit.stepId,
    unitID: change.unitID,
    type: change.type,
    revision: change.revision,
    policyVersion: policy.version,
    sdkVersion: policy.sdkVersion,
    imageDigest: policy.imageDigest,
    contentDigest: createHash("sha256").update(bytes).digest("hex"),
    source: "sdk-submit",
  });
  const header = {
    kind: "changeset",
    unitID: change.unitID,
    type: producer.type,
    baseRev: change.baseRev,
    revision: change.revision,
    sid: permit.sid,
    reqId: permit.reqId,
  } satisfies typeof HostValueHeader.Type;
  return { bytes, producer, header };
}
