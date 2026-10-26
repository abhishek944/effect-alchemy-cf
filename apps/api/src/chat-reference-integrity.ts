import type { UserInput } from "@earendil-works/pi-durable";
import type { AcceptedInputRecord } from "./chat-accepted-input-schema.ts";
import { sameAcceptedInputValue } from "./chat-accepted-input-values.ts";
import { compactImageInput } from "./chat-image-input-content.ts";
import { CHAT_REFERENCE_INPUT_PREFIX } from "./chat-reference-input.ts";

/** Missing/altered selected-reference sidecars must never fall back to whole-original hydration. */
export function matchingCompactReferenceInput(
  content: UserInput,
  candidate: AcceptedInputRecord,
): boolean {
  const last = typeof content === "string" ? undefined : content.at(-1);
  const hasReferenceBlock =
    typeof content !== "string" &&
    content.length > 1 &&
    last?.type === "text" &&
    last.text.startsWith(CHAT_REFERENCE_INPUT_PREFIX);
  // Historical rows keep their exact existing digest proof, including legacy object key order.
  if ((candidate.referenceInputs?.length ?? 0) === 0 && !hasReferenceBlock) return true;
  if (typeof content === "string" || content[0]?.type !== "text") return false;
  return sameAcceptedInputValue(
    content,
    compactImageInput(
      content[0].text,
      candidate.originals,
      candidate.officeTarget,
      candidate.referenceInputs,
    ),
  );
}
