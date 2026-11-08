/**
 * WebP avatar decode. The codec is WebAssembly shipped with `@jsquash/webp`;
 * the Node runtime reads that asset from disk instead of relying on a bundler.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import decodeWebp, { init } from "@jsquash/webp/decode.js";
import { Schema } from "effect";
import { decodeOption } from "./chat-internal.ts";
import { AVATAR_MAX_PIXELS, WEBP_MAX_DECODED_BYTES } from "./profile-model.ts";
import type { DecodedImage } from "./profile-decode.ts";

const Dimension = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n > 0));
const WebpPixels = Schema.Struct({
  width: Dimension,
  height: Dimension,
  data: Schema.declare<Uint8ClampedArray>(
    (value): value is Uint8ClampedArray => value instanceof Uint8ClampedArray,
  ),
});

const wasmPath = (): string => {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("@jsquash/webp/package.json")), "codec/dec/webp_dec.wasm");
};

let ready: Promise<void> | null = null;

const prepare = (): Promise<void> => {
  if (ready === null) {
    ready = (async () => {
      const module = await WebAssembly.compile(await readFile(wasmPath()));
      await init({
        instantiateWasm(
          imports: WebAssembly.Imports,
          receive: (instance: WebAssembly.Instance) => void,
        ) {
          const instance = new WebAssembly.Instance(module, imports);
          receive(instance);
          return instance.exports;
        },
      });
    })();
  }
  return ready;
};

export const decodeWebpBytes = async (bytes: Uint8Array): Promise<DecodedImage | null> => {
  try {
    await prepare();
    // Foreign package types require DOM ImageData; validate pixels explicitly.
    const buffer = Uint8Array.from(bytes).buffer;
    const raw: unknown = await decodeWebp(buffer);
    const image = decodeOption(WebpPixels, raw);
    if (image === null) return null;
    const { width, height } = image;
    if (width * height > AVATAR_MAX_PIXELS || image.data.byteLength > WEBP_MAX_DECODED_BYTES)
      return null;
    return image.data.length === width * height * 4 ? { width, height } : null;
  } catch {
    return null;
  }
};
