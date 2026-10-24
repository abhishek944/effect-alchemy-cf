/**
 * Image callers keep their historical names; the bounded proof primitives are owned by the
 * feature-neutral accepted-input boundary so Office and image proof share one implementation.
 */
export {
  AcceptedEntryId as ImageEntryId,
  AcceptedIndex as ImageSafeInteger,
  acceptedInputFailure as imageProofFailure,
  freezeAcceptedInputValue as freezeImageRequestValue,
  sameAcceptedInputValue as sameImageRequestValue,
} from "./chat-accepted-input-values.ts";
export { MAX_ACCEPTED_INPUT_PROOF_CHARACTERS as MAX_IMAGE_PROOF_CHARACTERS } from "./chat-accepted-input-values.ts";
