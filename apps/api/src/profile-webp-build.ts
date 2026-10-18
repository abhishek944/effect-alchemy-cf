import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { chatObjectsEntryPlugin } from "./chat-objects-entry.ts";

/** Shared provider emits the static import as a real Worker CompiledWasm module. */
export const profileWebpPlugin = (): ReturnType<typeof chatObjectsEntryPlugin> => ({
  name: "starter:profile-webp",
  resolveId(source: string) {
    return source === "./profile-webp.wasm" ? { id: "./profile-webp.wasm", external: true } : null;
  },
  buildStart() {
    this.emitFile({
      type: "asset",
      fileName: "profile-webp.wasm",
      source: readFileSync(
        fileURLToPath(import.meta.resolve("@jsquash/webp/codec/dec/webp_dec.wasm")),
      ),
    });
  },
});
