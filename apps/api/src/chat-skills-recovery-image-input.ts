import type { UserInput } from "@earendil-works/pi-durable";
import { Schema } from "effect";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import { SkillRuntimeError } from "./chat-skills-errors.ts";
import { digestCompactImageInput } from "./chat-image-response-digest.ts";

export type SkillRecoveryImageInput = {
  readonly kind: "retry" | "new-send";
  readonly scope: ChatSendScope;
  readonly operationId: string;
  readonly logicalOperationId: string;
  readonly identityHash: string;
  readonly sourceAttemptId: string;
  readonly sourceLogicalOperationId: string;
  readonly selection: ChatSelection;
  readonly content: UserInput;
  readonly reused: boolean;
  readonly retryKey: string | null;
};
const BoundedText = Schema.String;
const Text = Schema.Struct({
  type: Schema.Literal("text"),
  text: BoundedText,
  textSignature: Schema.optionalKey(BoundedText),
});
const Image = Schema.Struct({
  type: Schema.Literal("image"),
  data: BoundedText,
  mimeType: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(128)),
});
const FrozenInput = Schema.Union([
  BoundedText,
  Schema.mutable(Schema.Array(Schema.Union([Text, Image]))),
]);
const invalid = (): never => {
  throw new SkillRuntimeError("invalid", "The stored message content is inconsistent.");
};

/** Legacy input is readable for proof, never automatically copied into a new row. */
export function verifiedRecoveryContent(raw: string): UserInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return invalid();
  }
  let content: UserInput;
  try {
    content = Schema.decodeUnknownSync(FrozenInput, { onExcessProperty: "error" })(parsed);
  } catch {
    return invalid();
  }
  return freezeRecoveryContent(content);
}
function freezeRecoveryContent(content: UserInput): UserInput {
  if (typeof content !== "string") {
    for (const part of content) Object.freeze(part);
    Object.freeze(content);
  }
  return content;
}

/** Snapshot before the asynchronous hash so a callback cannot change admitted content. */
export async function storeCompactRecoveryContent(content: UserInput): Promise<string> {
  if (typeof content !== "string") {
    if (!Array.isArray(content)) return invalid();
    for (const part of content) if (part?.type !== "text") return invalid();
  }
  let verified: UserInput;
  try {
    verified = Schema.decodeUnknownSync(FrozenInput, { onExcessProperty: "error" })(content);
  } catch {
    return invalid();
  }
  freezeRecoveryContent(verified);
  await digestCompactImageInput(verified);
  return JSON.stringify(verified, ["type", "text", "textSignature"]);
}
export async function matchingCompactRecoveryContent(
  raw: string,
  content: UserInput,
): Promise<UserInput> {
  const stored = await storeCompactRecoveryContent(content);
  const existing = verifiedRecoveryContent(raw);
  if (
    (await digestCompactImageInput(existing)) !==
    (await digestCompactImageInput(verifiedRecoveryContent(stored)))
  )
    return invalid();
  return existing;
}

/** Structural native equality includes empty blocks/signatures without serializing inline bodies. */
export function sameRecoveryContent(left: UserInput, right: UserInput): boolean {
  if (typeof left === "string" || typeof right === "string") return left === right;
  if (left.length !== right.length) return false;
  return left.every((part, index) => {
    const other = right[index];
    if (part.type === "text")
      return (
        other?.type === "text" &&
        part.text === other.text &&
        part.textSignature === other.textSignature
      );
    return other?.type === "image" && part.data === other.data && part.mimeType === other.mimeType;
  });
}
export function freezeRecoveryImageInput(input: SkillRecoveryImageInput): SkillRecoveryImageInput {
  return Object.freeze({
    ...input,
    scope: Object.freeze({ ...input.scope, chat: Object.freeze({ ...input.scope.chat }) }),
    selection: Object.freeze({ ...input.selection }),
    content: freezeRecoveryContent(input.content),
  });
}
