import type { ArtifactRef } from "@starter/office-contract";
import type { NativeChange } from "../storage-remote/wire.ts";
import type { NativeTarget } from "./identity.ts";
import type { NativeReceiptBinding, NativeReceiptKey } from "./native-receipts.ts";

/** Genuine native submission identity, never a business operation or bearer credential. */
export type NativeEditorPermit = {
  readonly target: NativeTarget;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
  readonly submissionId: string;
  readonly stepId: string;
  readonly channelId: string;
  readonly editorId: string;
  readonly editorEpoch: number;
  readonly memberId: string;
  readonly sid: string;
  readonly reqId: number;
  /** Server-admitted head; the SDK may transform an older client base to this head. */
  readonly expectedHead: number;
};

/** Exact transformed commit references, staged before dispatch and bound to the accepted receipt. */
export type NativeEditorLeaf = {
  readonly id: string;
  readonly submissionId: string;
  readonly payload: ArtifactRef;
  readonly receipt: Extract<NativeReceiptKey, { kind: "main-change" | "draft-change" }>;
  readonly committed: NativeChange;
};

/** Finite outcome metadata only. A committed ref never confers permission to fetch its bytes. */
export type NativeEditorObservation =
  | {
      readonly state: "confirmed";
      readonly binding: NativeReceiptBinding;
      readonly acceptedRevision: number;
      readonly committed: NativeChange;
    }
  | { readonly state: "unknown" };
