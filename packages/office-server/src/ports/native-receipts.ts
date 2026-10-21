import { Schema } from "effect";
import { Count, Digest, Revision } from "@starter/office-contract";
import type { Effect } from "effect";
import type { OfficeError } from "@starter/office-contract";
import type { NativeTarget } from "./identity.ts";

const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
/** Semantic publication keys. Only the concrete bridge knows private database action strings. */
export const NativeReceiptKey = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("create-main") }),
  Schema.Struct({ kind: Schema.Literal("snapshot"), revision: Revision }),
  Schema.Struct({ kind: Schema.Literal("main-change"), revision: Revision }),
  Schema.Struct({
    kind: Schema.Literals(["create-worktree", "add-unit", "create-draft"]),
    worktreeId: NativeId,
  }),
  Schema.Struct({
    kind: Schema.Literals(["merge-artifact", "merge-result"]),
    worktreeId: NativeId,
    readyRevision: Revision,
  }),
  Schema.Struct({
    kind: Schema.Literal("draft-change"),
    worktreeId: NativeId,
    revision: Revision,
  }),
  Schema.Struct({
    kind: Schema.Literal("transition"),
    worktreeId: NativeId,
    generation: Count,
    target: Schema.Literals(["draft", "ready", "merging", "merged", "discarded"]),
  }),
  Schema.Struct({
    kind: Schema.Literal("set-removed"),
    worktreeId: NativeId,
    generation: Count,
    removed: Schema.Boolean,
  }),
]);
export type NativeReceiptKey = typeof NativeReceiptKey.Type;
/** Prepared by the trusted native provider, never copied from the observation being checked. */
export const NativeReceiptBinding = Schema.Struct({
  fingerprint: Digest,
  authorityEpoch: Count.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type NativeReceiptBinding = typeof NativeReceiptBinding.Type;
export type NativeReceiptObservation =
  | {
      readonly state: "confirmed";
      readonly fingerprint: string;
      readonly authorityEpoch: number;
      /** Exact original accepted header, never a current head or a caller-supplied guess. */
      readonly acceptedRevision: number | null;
    }
  | { readonly state: "unknown" };
/**
 * Fresh recovery-observe authorization and the immutable journal binding are prerequisites.
 * Verify the durable journal/payload/slot preparation and exact fingerprint/original epoch.
 * Different journals may not bind the same receipt slot. Mismatch is an integrity error.
 * Missing preparation/evidence never proves absence or permits replay.
 * Old-generation receipt metadata does not grant old native content/reference access.
 */
export type ObserveNativeReceipt = (input: {
  readonly target: NativeTarget;
  readonly operationId: string;
  readonly stepId: string;
  readonly writeId: string;
  readonly payloadDigest: string;
  readonly receipt: NativeReceiptKey;
  readonly expected: NativeReceiptBinding;
}) => Effect.Effect<NativeReceiptObservation, OfficeError>;
