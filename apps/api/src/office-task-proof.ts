import { Schema } from "effect";
import {
  Count,
  ChatReferenceInput,
  DraftTarget,
  ArtifactRef,
  Digest,
  Id,
  OFFICE_LIMITS,
  OfficeCommand,
  officeImportOptions,
  OfficeSendTarget,
  decodeWireSync,
} from "@starter/office-contract";
import { OriginalActorClaims } from "@starter/office-server/ports";
import type { OfficeIntentCommand } from "@starter/office-pi";
import { DomainUuid } from "./chat-capabilities.ts";
import { ImageOriginalBinding, ImageResponseIdentity } from "./chat-image-response-schema.ts";
import { decodeChatOfficeSession } from "./chat-office-session.ts";
import { freezeImageRequestValue } from "./chat-image-request-values.ts";
import type { OfficeTaskAssociation } from "./chat-office-task-association.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { OfficeTaskFile, officeTaskFile } from "./office-task-file.ts";
import type { ArtifactRef as ArtifactReference } from "@starter/office-contract";

/** Private callback selectors only. Never credentials or a browser/model grant request. */
export const OfficeTaskSelector = Schema.Struct({
  chatId: DomainUuid,
  chatScope: ImageResponseIdentity,
  leaseId: Id,
});
export type OfficeTaskSelector = typeof OfficeTaskSelector.Type;
export const OfficeStageReceipt = Schema.Struct({
  toolTaskId: OriginalActorClaims.members[1].fields.acceptedInput.fields.toolTaskId,
  artifact: Schema.Struct({ ...ArtifactRef.fields, kind: Schema.Literals(["upload", "code"]) }),
  fileRef: Schema.optionalKey(DomainUuid),
}).check(
  Schema.makeFilter(
    (receipt) => receipt.artifact.kind === "upload" || receipt.fileRef === undefined,
  ),
);
export type OfficeStageReceipt = typeof OfficeStageReceipt.Type;
export const OfficeStageReceipts = Schema.Array(OfficeStageReceipt).check(Schema.isMaxLength(32));
const Lease = Schema.Struct({ id: Id, notAfter: Count });
const Intent = Schema.Struct({
  operationId: Id,
  digest: Digest,
  command: Schema.Unknown,
  attachmentId: Schema.optionalKey(Id),
  referenceId: Schema.optionalKey(Id),
  step: Schema.optionalKey(Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9-]{0,63}$/))),
  basis: Schema.optionalKey(DraftTarget),
});
const Reply = Schema.Struct({
  lease: Lease,
  stagedArtifacts: OfficeStageReceipts,
  association: Schema.Struct({
    session: Schema.Unknown,
    chatId: DomainUuid,
    chatScope: ImageResponseIdentity,
    callId: ImageResponseIdentity,
    acceptedInput: OriginalActorClaims.members[1].fields.acceptedInput,
    intent: Intent,
    target: Schema.NullOr(OfficeSendTarget),
    originals: Schema.Array(ImageOriginalBinding).check(Schema.isMaxLength(5)),
    retained: Schema.NullOr(OfficeTaskFile),
    reference: Schema.optionalKey(ChatReferenceInput),
  }),
});
const StagedCode = Schema.Struct({
  command: Schema.Literal("stage-code"),
  input: Schema.Struct({
    operationId: Id,
    digest: Digest,
    bytes: Count.check(Schema.isLessThanOrEqualTo(OFFICE_LIMITS.codeBytes)),
  }),
});
function decodeCommand(value: unknown): OfficeIntentCommand {
  if (
    typeof value === "object" &&
    value !== null &&
    "command" in value &&
    value.command === "stage-code"
  )
    return decodeWireSync(StagedCode)(value);
  const decoded = decodeWireSync(OfficeCommand)(value);
  if (decoded.command === "stage-code") throw officeDenied();
  return decoded;
}
export type OfficeTaskProof = {
  readonly lease: typeof Lease.Type;
  readonly association: OfficeTaskAssociation;
  readonly stagedArtifacts: readonly OfficeStageReceipt[];
};

/** Content correlation only AFTER genuine callback/session proof. IDs and schema are not authentication. */
export function officeTaskStagedRef(proof: OfficeTaskProof, ref: ArtifactReference): boolean {
  const command = proof.association.intent.command;
  const id =
    command.command === "execute"
      ? command.input.codeId
      : command.command === "create" && command.input.source.kind === "office"
        ? command.input.source.uploadId
        : command.command === "import-into"
          ? command.input.source.id
          : null;
  return (
    ref.id === id &&
    ref.kind === (command.command === "execute" ? "code" : "upload") &&
    proof.stagedArtifacts.some((receipt) => officeSame(receipt.artifact, ref))
  );
}

/** Descriptive source only from an actual immutable native stage ACK; never digest-based identity. */
export function officeTaskSourceFile(proof: OfficeTaskProof) {
  const command = proof.association.intent.command;
  const id =
    command.command === "create" && command.input.source.kind === "office"
      ? command.input.source.uploadId
      : command.command === "import-into"
        ? command.input.source.id
        : null;
  if (id === null) return undefined;
  const receipt = proof.stagedArtifacts.find((item) => item.artifact.id === id);
  if (receipt?.fileRef === undefined) return undefined; // Historical identity is unknown, never guessed.
  const file = officeTaskFile(proof.association, receipt.fileRef);
  const upload = receipt.artifact;
  if (
    !file ||
    !officeImportOptions(file.mediaType, file.name) ||
    upload.kind !== "upload" ||
    upload.digest !== file.digest ||
    upload.bytes !== file.byteSize ||
    upload.mediaType !== "application/octet-stream"
  )
    throw officeDenied();
  return {
    chatId: proof.association.chatId,
    fileRef: file.fileId,
    name: file.name,
    upload: { ...upload, kind: "upload" as const },
  };
}

/** Structural private metadata only; caller MUST prove actual original callback binding first. */
export function decodeOfficeTaskProof(input: unknown): OfficeTaskProof {
  const decoded = decodeWireSync(Reply)(input);
  const association = decoded.association;
  const session = decodeChatOfficeSession(JSON.stringify(association.session) ?? null);
  if (session === null) throw officeDenied();
  const reference = association.reference;
  if (association.intent.referenceId !== undefined) {
    if (
      association.intent.attachmentId !== undefined ||
      reference?.kind !== "native" ||
      reference.id !== association.intent.referenceId ||
      !officeSame(reference.target, association.target)
    )
      throw officeDenied();
  } else if (reference !== undefined) throw officeDenied();
  return freezeImageRequestValue(
    {
      lease: decoded.lease,
      stagedArtifacts: decoded.stagedArtifacts,
      association: {
        ...association,
        session,
        intent: { ...association.intent, command: decodeCommand(association.intent.command) },
      },
    },
    true,
  );
}
