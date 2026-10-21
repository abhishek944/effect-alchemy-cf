import type { UserInput } from "@earendil-works/pi-durable";
import { Schema } from "effect";
import {
  ImageResponseError,
  MAX_IMAGE_RESPONSE_JSON_BYTES,
  responseValue,
} from "./chat-image-response-codec.ts";

export const MAX_COMPACT_IMAGE_INPUT_JSON_BYTES = MAX_IMAGE_RESPONSE_JSON_BYTES;
const CompactText = Schema.String.check(Schema.isMaxLength(MAX_COMPACT_IMAGE_INPUT_JSON_BYTES));
const TextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: CompactText,
  textSignature: Schema.optional(CompactText),
});

/**
 * Native 1.1.0 UserInput is content ONLY; placement adds UserMessage.timestamp.
 * The bridge must compare that timestamp separately, never invent it before submit.
 * Reject legacy image blocks before inspecting/serializing their binary data.
 */
export async function digestCompactImageInput(input: UserInput): Promise<string> {
  let compact: string | (typeof TextBlock.Type)[];
  if (typeof input === "string") {
    compact = responseValue(CompactText, input);
  } else {
    if (!Array.isArray(input) || input.length > MAX_COMPACT_IMAGE_INPUT_JSON_BYTES / 25)
      throw new ImageResponseError("invalid_input");
    compact = [];
    let characters = 2;
    for (const block of input) {
      // A type-only preflight avoids reading/encoding historical image.data at all.
      if (block?.type !== "text") throw new ImageResponseError("invalid_input");
      const text = responseValue(TextBlock, block);
      characters += text.text.length + (text.textSignature?.length ?? 0) + 25;
      if (characters > MAX_COMPACT_IMAGE_INPUT_JSON_BYTES)
        throw new ImageResponseError("invalid_input");
      compact.push(
        text.textSignature === undefined
          ? { type: "text", text: text.text }
          : { type: "text", text: text.text, textSignature: text.textSignature },
      );
    }
  }
  // Preflight bounds this allocation even for escaping-heavy strings.
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  if (bytes.byteLength > MAX_COMPACT_IMAGE_INPUT_JSON_BYTES)
    throw new ImageResponseError("invalid_input");
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
