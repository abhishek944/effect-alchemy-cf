import { createHash } from "node:crypto";
import type { IChangeset } from "@univerjs/protocol";
import type { SaveSnapshotInput } from "@univerjs-pro/collaboration-service";
import { decodeWireSync, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { encodeNativeFrame } from "@starter/office-contract/native-wire";
import {
  NativeChange,
  nativeValueDigest,
  type NativeProducer,
  type HostValueHeader,
} from "@starter/office-server/native-remote";
import {
  prepareSdkSnapshot,
  prepareSdkEditorCommit,
  decodeChangeset,
} from "@starter/office-server/native-codec";
import type { NativeSession } from "./native-client.ts";
import type { NativeValues } from "./native-values.ts";
import { nativeId, invalidBytes } from "./native-stream-io.ts";

export async function stageSdkSnapshot(
  s: NativeSession,
  values: NativeValues,
  input: SaveSnapshotInput,
  source: NativeProducer["source"],
) {
  s.check(undefined, input.snapshot.unitID);
  s.write();
  const expected = {
    unitID: s.target.unitId,
    type: input.snapshot.type,
    revision: input.snapshot.rev,
  };
  if ((input.sheetBlocks?.length ?? 0) > Math.min(4096, s.policy.limits.blockCount))
    throw invalidBytes();
  const framed = prepareSdkSnapshot(
    input.snapshot,
    input.sheetBlocks ?? [],
    expected,
    values.maximum,
  );
  const producer = values.producer(expected, framed.contentDigest, source);
  const blocks = [];
  for (const block of framed.blocks)
    blocks.push({
      blockID: block.id,
      value: await values.stage(block.bytes, block.blockHeader, producer),
    });
  const snapshot = await values.stage(framed.snapshot, framed.snapshotHeader, producer);
  return { producer, manifest: { ...expected, type: producer.type, snapshot, blocks } };
}
export async function stageSdkCommit(s: NativeSession, values: NativeValues, input: IChangeset) {
  s.check(input.userID, input.unitID);
  s.write();
  nativeId(input.memberID);
  if (input.sid !== undefined) nativeId(input.sid);
  const prepared =
    s.access.kind === "editor"
      ? prepareSdkEditorCommit(input, s.access.permit, s.policy, input.type)
      : null;
  const bytes = prepared?.bytes ?? encodeNativeFrame("changeset", input);
  const change = decodeChangeset(bytes, {
    unitID: s.target.unitId,
    type: input.type,
    revision: input.revision,
    baseRev: input.baseRev,
    sid: input.sid ?? null,
    reqId: input.reqId ?? null,
  });
  const producer =
    prepared?.producer ??
    values.producer(
      { unitID: input.unitID, type: input.type, revision: input.revision },
      createHash("sha256").update(bytes).digest("hex"),
      "sdk-submit",
    );
  const header: typeof HostValueHeader.Type = prepared?.header ?? {
    kind: "changeset",
    unitID: change.unitID,
    type: producer.type,
    revision: change.revision,
    baseRev: change.baseRev,
    sid: change.sid ?? null,
    reqId: change.reqId ?? null,
  };
  const value = await values.stage(bytes, header, producer);
  return {
    producer,
    change,
    changeset: decodeWireSync(NativeChange)({
      value,
      unitID: change.unitID,
      type: producer.type,
      baseRev: change.baseRev,
      revision: change.revision,
      sid: change.sid ?? null,
      reqId: change.reqId ?? null,
    }),
  };
}
export async function requireCommitted(
  values: NativeValues,
  input: Awaited<ReturnType<typeof stageSdkCommit>>,
  result: { readonly headRevision: number; readonly value: NativeChange["value"] },
): Promise<IChangeset> {
  if (
    result.headRevision !== input.change.revision ||
    (await nativeValueDigest(result.value)) !== (await nativeValueDigest(input.changeset.value))
  )
    throw new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN"));
  values.session.check();
  return input.change;
}
