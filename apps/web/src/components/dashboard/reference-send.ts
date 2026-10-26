import { freezeChatReferenceInputs, type ChatReferenceInputs } from "@starter/office-contract";
import type { SendSnapshot } from "@/lib/chat-store-context";

const safeBoundary = (text: string, offset: number) =>
  !(
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/.test(text.charAt(offset - 1)) &&
    /[\uDC00-\uDFFF]/.test(text.charAt(offset))
  );

/** Bounds and atomic scalar boundaries are checked against this exact caption, never a label. */
export function freezeReferenceDraft(
  text: string,
  inputs: ChatReferenceInputs,
): ChatReferenceInputs {
  const frozen = freezeChatReferenceInputs(inputs);
  if (
    frozen.some(
      (input) =>
        input.end > text.length ||
        !safeBoundary(text, input.start) ||
        !safeBoundary(text, input.end),
    )
  )
    throw new Error("A reference no longer matches the message text. Remove it and add it again.");
  return frozen;
}

/** Trim once before constructing Send identity; preserve the editor's separate raw draft basis. */
export function normalizeReferenceCaption(text: string, inputs: ChatReferenceInputs) {
  const original = freezeReferenceDraft(text, inputs);
  const leading = text.length - text.trimStart().length;
  const caption = text.trim();
  const end = leading + caption.length;
  if (original.some((input) => input.start < leading || input.end > end))
    throw new Error(
      "Trimming would split a reference. Remove it and add it again; your draft is kept.",
    );
  return Object.freeze({
    text: caption,
    inputs: freezeReferenceDraft(
      caption,
      original.map((input) => ({
        ...input,
        start: input.start - leading,
        end: input.end - leading,
      })),
    ),
  });
}

export function freezeSendDraft(text: string, fields: SendSnapshot): SendSnapshot {
  const inputs = freezeReferenceDraft(text, fields.referenceInputs ?? []);
  return {
    selection: Object.freeze({ ...fields.selection }),
    attachments: Object.freeze([...fields.attachments]),
    references: Object.freeze([...fields.references]),
    ...(inputs.length ? { referenceInputs: inputs } : {}),
  };
}
