import { Schema } from "effect";
import { Count, Digest, DraftTarget } from "@starter/office-contract";
import type { DocumentScope, OfficeError } from "@starter/office-contract";
import type { Effect } from "effect";

const ClaimId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const OwnerClaims = Schema.Struct({ stage: ClaimId, ownerId: ClaimId });
export type OwnerScope = typeof OwnerClaims.Type;
const PrincipalClaims = Schema.Struct({
  owner: OwnerClaims,
  principalId: ClaimId,
  sessionEpoch: Count,
  invocationId: ClaimId,
  expiresAt: Count,
});
const HumanClaims = Schema.Struct({
  ...PrincipalClaims.fields,
  capability: Schema.Literal("human"),
});
const TaskClaims = Schema.Struct({
  ...PrincipalClaims.fields,
  capability: Schema.Literal("draft-task"),
  target: Schema.NullOr(DraftTarget),
  acceptedInput: Schema.Struct({
    requestId: ClaimId,
    submissionId: ClaimId,
    conversationId: ClaimId,
    toolTaskId: ClaimId,
    generationTaskId: ClaimId,
    assistantEntryId: ClaimId,
    digest: Digest,
  }),
});
/** Bounded original claims only. Not a credential and never trusted merely because decoded. */
export const OriginalActorClaims = Schema.Union([HumanClaims, TaskClaims]);
export type ActorClaims = typeof OriginalActorClaims.Type;
export type HumanActor = typeof HumanClaims.Type;
export type TaskActor = typeof TaskClaims.Type;
export type RecoveryActor = typeof PrincipalClaims.Type & {
  readonly capability: "recovery";
  readonly operationId: string;
  readonly documentId: string;
};
/** Constructed by trusted verification; no browser/model actor schema is exported. */
export type Actor = ActorClaims | RecoveryActor;
export type NativeTarget = {
  readonly owner: OwnerScope;
  readonly documentId: string;
  readonly unitId: string;
  readonly scope: DocumentScope;
};
export type WritePermit = {
  readonly owner: OwnerScope;
  readonly documentId: string;
  readonly operationId: string;
  readonly stepId: string;
  readonly authorityEpoch: number;
  readonly serviceEpoch: number;
  readonly target: NativeTarget;
  readonly expectedHead: number | null;
  readonly expectedGeneration: number | null;
  readonly reviewFingerprint: string | null;
};
export type ActorVerification = { readonly claims: ActorClaims } & (
  | {
      readonly phase: "request";
      readonly operationId: string | null;
      readonly intentDigest: string | null;
      readonly target: NativeTarget | null;
    }
  | {
      readonly phase: "final-commit" | "recovery-observe" | "recovery-dispatch";
      readonly operationId: string;
      readonly intentDigest: string;
      readonly target: NativeTarget;
    }
);
/**
 * Fresh host-current authority check, captured once by core and called at actual admission.
 * Null task targets allow list/stage/new-draft preparation, NEVER unscoped native commits.
 * Recovery observation cannot authorize redispatch; verify that phase separately.
 * Host checks accepted immutable lineage and current owner/session/target/revocation policy.
 */
export type VerifyActor = (input: ActorVerification) => Effect.Effect<void, OfficeError>;
