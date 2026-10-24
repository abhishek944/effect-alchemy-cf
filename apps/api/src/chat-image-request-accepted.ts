import type { ConversationId, SubmissionId } from "@earendil-works/pi-durable";
import type { ImageBoundInput } from "./chat-image-response-schema.ts";
import type { ImageNativeAccess, ImageNativeContext } from "./chat-image-request-types.ts";
import {
  bindPlacedAcceptedInput,
  readPlacedAcceptedInput,
  resolveAcceptedInput,
  type PlacedAcceptedInput,
} from "./chat-accepted-input.ts";

/**
 * Image-facing names over the neutral accepted-input owner. Image authority is the accepted
 * send scope itself; the response store only records the optional image capability.
 */
export {
  requireAcceptedInputAccess as requireImageAccess,
  requireAcceptedInputCandidate as requireImageCandidate,
  verifyAcceptedInputEntry as verifyImageBoundEntry,
} from "./chat-accepted-input.ts";
export type PlacedImageInput = PlacedAcceptedInput;

export const readPlacedImageInput = (
  access: ImageNativeAccess,
  conversationId: ConversationId,
  submissionId: SubmissionId,
  context: ImageNativeContext,
): Promise<PlacedAcceptedInput> =>
  readPlacedAcceptedInput(access, conversationId, submissionId, context);

/** Candidate-only image authority: legacy input can NEVER enter this CAS/paid-tool path. */
export const bindNativeImageInput = (
  access: ImageNativeAccess,
  native: PlacedAcceptedInput,
  context: ImageNativeContext,
): Promise<ImageBoundInput> => bindPlacedAcceptedInput(access, native, context);

/** Strict image resolver stays separate from the ordinary legacy continuation classifier. */
export const resolveAcceptedImageInput = (
  access: ImageNativeAccess,
  conversationId: ConversationId,
  submissionId: SubmissionId,
  context: ImageNativeContext,
): Promise<ImageBoundInput> => resolveAcceptedInput(access, conversationId, submissionId, context);
