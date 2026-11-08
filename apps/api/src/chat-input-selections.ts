import { Schema } from "effect";
import type { Message } from "@earendil-works/pi-ai";
import type { AcceptedInputRecord } from "./chat-accepted-input-schema.ts";

/** Display-only strings; no native selectors or read/write authority cross this boundary. */
export const InputSelection = Schema.Struct({
  name: Schema.String,
  scope: Schema.String,
  quote: Schema.NullOr(Schema.String),
});
export type InputSelection = typeof InputSelection.Type;
export const InputSelections = Schema.Array(InputSelection);

/** Accepted entry association is supplied by the immutable store, never today's editor/tray. */
export function publicInputSelections(
  message: Message,
  accepted: AcceptedInputRecord | null,
): readonly InputSelection[] {
  if (accepted === null || message.role !== "user" || typeof message.content !== "string")
    return [];
  const inputs = accepted.referenceInputs ?? [];
  const selections: InputSelection[] = [];
  // Offsets alone do not preserve the exact quotation; never reread live content.
  for (const input of inputs) {
    if (input.text === undefined) continue;
    const original = accepted.originals.find((file) => file.fileId === input.fileId);
    if (original) selections.push({ name: original.name, scope: "Selected text", quote: null });
  }
  return selections;
}
