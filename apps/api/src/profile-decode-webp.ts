/**
 * Worker-only codec chunk: kept out of Node-safe stack module initialization.
 * The provider emits an imported CompiledWasm module; never compile bytes here.
 */
import type * as cf from "@cloudflare/workers-types";
import { Schema } from "effect";
import decodeWebp, { init } from "@jsquash/webp/decode.js";
import webpModule from "./profile-webp.wasm";
import { decodeOption } from "./chat-internal.ts";
import { AVATAR_MAX_PIXELS, WEBP_MAX_DECODED_BYTES } from "./profile-model.ts";
import type { DecodedImage } from "./profile-decode.ts";

// This chunk executes only in Workers; qualify its platform API for Node type graphs.
declare const WebAssembly: typeof cf.WebAssembly;

const Dimension = Schema.Number.check(Schema.makeFilter((n) => Number.isSafeInteger(n) && n > 0));
const WebpPixels = Schema.Struct({
  width: Dimension,
  height: Dimension,
  data: Schema.declare<Uint8ClampedArray>(
    (value): value is Uint8ClampedArray => value instanceof Uint8ClampedArray,
  ),
});
let ready: Promise<void> | null = null;

const prepare = (): Promise<void> => {
  if (ready === null) {
    ready = init({
      instantiateWasm(
        imports: cf.WebAssembly.Imports,
        receive: (instance: cf.WebAssembly.Instance) => void,
      ) {
        // Pinned package declarations misname this callback's actual Instance.
        const instance = new WebAssembly.Instance(webpModule, imports);
        receive(instance);
        return instance.exports;
      },
    });
  }
  return ready;
};

export const decodeWebpBytes = async (bytes: Uint8Array): Promise<DecodedImage | null> => {
  try {
    await prepare();
    // Foreign package types require DOM ImageData, absent in the Worker graph.
    // Validate the returned pixels explicitly instead of asserting that type.
    const raw: unknown = await decodeWebp(Uint8Array.from(bytes).buffer);
    const image = decodeOption(WebpPixels, raw);
    if (image === null) return null;
    const { width, height } = image;
    if (width * height > AVATAR_MAX_PIXELS || image.data.byteLength > WEBP_MAX_DECODED_BYTES)
      return null;
    // jSquash frees native RGBA before returning its independent JS copy.
    return image.data.length === width * height * 4 ? { width, height } : null;
  } catch {
    return null;
  }
};
