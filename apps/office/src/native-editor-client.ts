import { Effect } from "effect";
import { HostEditor } from "@starter/office-server/native-remote";
import type { ArtifactRef } from "@starter/office-contract";
import type {
  NativeEditorPermit,
  NativeEditorLeaf,
  NativeReceiptBinding,
} from "@starter/office-server/ports";
import type { OfficeControlCaller } from "./native-channel.ts";

/** Real private calls only. A duplicate/unknown result supplies no dispatch permit. */
export function createOfficeEditorClient(
  channel: OfficeControlCaller,
  cleanup: OfficeControlCaller,
) {
  return Object.freeze({
    join: (viewId: string, until: number) => channel.call(HostEditor.join, { viewId, until }, true),
    revoke: () => cleanup.call(HostEditor.revoke, {}, true).pipe(Effect.asVoid),
    admit: (
      submissionId: string,
      turnId: string,
      input: {
        readonly sid: string;
        readonly reqId: number;
        readonly client: ArtifactRef;
      },
    ) => channel.call(HostEditor.admit, { submissionId, turnId, ...input }, true),
    stage: (permit: NativeEditorPermit, leaf: NativeEditorLeaf) =>
      channel.call(HostEditor.stage, { permit, leaf }, true),
    prepare: (permit: NativeEditorPermit, writeId: string, binding: NativeReceiptBinding) =>
      channel.call(HostEditor.prepare, { permit, writeId, binding }, true),
    observe: (permit: NativeEditorPermit) => channel.call(HostEditor.observe, { permit }, false),
    release: (permit: NativeEditorPermit) =>
      cleanup.call(HostEditor.release, { permit }, true).pipe(Effect.asVoid),
  });
}
export type OfficeEditorClient = ReturnType<typeof createOfficeEditorClient>;
