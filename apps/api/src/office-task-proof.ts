import { Schema } from "effect";
import {
  Count,
  Digest,
  Id,
  OFFICE_LIMITS,
  OfficeCommand,
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
import { officeDenied } from "./office-private-authority.ts";

/** Private callback selectors only. Never credentials or a browser/model grant request. */
export const OfficeTaskSelector = Schema.Struct({
  chatId: DomainUuid,
  chatScope: ImageResponseIdentity,
  leaseId: Id,
});
export type OfficeTaskSelector = typeof OfficeTaskSelector.Type;
const Lease = Schema.Struct({ id: Id, notAfter: Count });
const Intent = Schema.Struct({ operationId: Id, digest: Digest, command: Schema.Unknown });
const Reply = Schema.Struct({
  lease: Lease,
  association: Schema.Struct({
    session: Schema.Unknown,
    chatId: DomainUuid,
    chatScope: ImageResponseIdentity,
    callId: ImageResponseIdentity,
    acceptedInput: OriginalActorClaims.members[1].fields.acceptedInput,
    intent: Intent,
    target: Schema.NullOr(OfficeSendTarget),
    originals: Schema.Array(ImageOriginalBinding).check(Schema.isMaxLength(5)),
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
function command(value: unknown): OfficeIntentCommand {
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
};

/** Structural private metadata only; caller MUST prove actual original callback binding first. */
export function decodeOfficeTaskProof(input: unknown): OfficeTaskProof {
  const decoded = decodeWireSync(Reply)(input);
  const association = decoded.association;
  const session = decodeChatOfficeSession(JSON.stringify(association.session) ?? null);
  if (session === null) throw officeDenied();
  return freezeImageRequestValue(
    {
      lease: decoded.lease,
      association: {
        ...association,
        session,
        intent: { ...association.intent, command: command(association.intent.command) },
      },
    },
    true,
  );
}
