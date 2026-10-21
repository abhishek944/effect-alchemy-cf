import type { Context, Message } from "@earendil-works/pi-ai";
import type { GenerationRequestProof } from "./chat-image-request-types.ts";

const invalid = (): never => {
  throw new Error("Request message identity could not be verified.");
};

/** Shared by image and ordinary legacy branches; no value-based identity fallback. */
export const generationUserPositions = (
  original: Context,
  projected: Context,
): Map<Message, number> => {
  const before = original.messages.filter((message) => message.role === "user");
  const after = projected.messages.filter((message) => message.role === "user");
  if (before.length !== after.length || before.some((message, index) => message !== after[index]))
    invalid();
  const positions = new Map<Message, number>();
  projected.messages.forEach((message, index) => {
    if (message.role !== "user") return;
    if (positions.has(message)) invalid();
    positions.set(message, index);
  });
  return positions;
};

/** SDK normalize/collapse keeps UserMessage wrappers; never infer identity from values. */
export const remapImageGenerationProof = (
  proof: GenerationRequestProof,
  original: Context,
  projected: Context,
): GenerationRequestProof => {
  const positions = generationUserPositions(original, projected);
  let previous = -1;
  const inputs = proof.inputs.map((occurrence) => {
    const message = original.messages[occurrence.requestIndex];
    if (message?.role !== "user") return invalid();
    const requestIndex = positions.get(message);
    if (requestIndex === undefined || requestIndex <= previous) return invalid();
    previous = requestIndex;
    return Object.freeze({ ...occurrence, requestIndex });
  });
  return Object.freeze({ ...proof, inputs: Object.freeze(inputs) });
};
