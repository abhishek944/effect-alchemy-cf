import type { UserInput } from "./chat-transcript-types.ts";
import { Schema } from "effect";
import { ImageResponseError, responseValue } from "./chat-image-response-codec.ts";

const TextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.String,
  textSignature: Schema.optional(Schema.String),
});

/** Native input is content only. Binary blocks never become compact metadata authority. */
export async function digestCompactImageInput(input: UserInput): Promise<string> {
  let compact: string | (typeof TextBlock.Type)[];
  if (typeof input === "string") compact = input;
  else {
    compact = [];
    for (const block of input) {
      if (block.type !== "text") throw new ImageResponseError("invalid_input");
      const text = responseValue(TextBlock, block);
      compact.push(
        text.textSignature === undefined
          ? { type: "text", text: text.text }
          : { type: "text", text: text.text, textSignature: text.textSignature },
      );
    }
  }
  const bytes = new TextEncoder().encode(JSON.stringify(compact));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
