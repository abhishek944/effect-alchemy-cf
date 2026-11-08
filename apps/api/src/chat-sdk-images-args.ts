/**
 * Exact installed 0.6.0 image_generate arguments.
 *
 * The Worker-side descriptor declares these same controls. Decoding refuses
 * extra provider/path/credential fields and the package's own reference count
 * and string bounds before the portable engine sees the arguments.
 */
import { Option, Schema } from "effect";

const ImageArguments = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(32_000)),
  image: Schema.optional(
    Schema.Array(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(8192))).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(16),
    ),
  ),
  size: Schema.optional(Schema.Literals(["auto", "1024x1024", "1024x1536", "1536x1024"])),
  quality: Schema.optional(Schema.Literals(["auto", "low", "medium", "high", "xhigh", "max"])),
});
export type ImageArguments = typeof ImageArguments.Type;

export const decodeImageArguments = (raw: unknown): ImageArguments | null => {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const image: unknown = Reflect.get(raw, "image");
  if (image !== undefined && (!Array.isArray(image) || image.length < 1 || image.length > 16))
    return null;
  if (Object.keys(raw).length > 4) return null;
  const valid = Option.getOrNull(
    Schema.decodeUnknownOption(ImageArguments, { onExcessProperty: "error" })(raw),
  );
  if (valid === null) return null;
  return {
    prompt: valid.prompt,
    ...(valid.image === undefined ? {} : { image: valid.image }),
    ...(valid.size === undefined ? {} : { size: valid.size }),
    ...(valid.quality === undefined ? {} : { quality: valid.quality }),
  };
};
