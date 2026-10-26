import type { SendMessage } from "./chat-model.ts";
import { chatReferenceInputsIdentity, officeSendTargetIdentity } from "@starter/office-contract";

/** Bind retries to the complete immutable send, not today's preferences. */
export const sendIdentity = (input: typeof SendMessage.Type): string =>
  JSON.stringify([
    input.text,
    input.selection.provider,
    input.selection.model,
    input.selection.effort,
    input.attachments,
    // Empty references preserve the exact historical identity for delivery recovery.
    ...((input.references?.length ?? 0) === 0 ? [] : [input.references]),
    // An absent target preserves every historical Send identity byte.
    ...(input.officeTarget === undefined ? [] : [officeSendTargetIdentity(input.officeTarget)]),
    ...((input.referenceInputs?.length ?? 0) === 0
      ? []
      : [chatReferenceInputsIdentity(input.referenceInputs ?? [])]),
  ]);
