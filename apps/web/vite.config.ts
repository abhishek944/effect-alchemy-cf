import { cpSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

/** Copy the complete production frame tree, including its relative native Worker assets. */
function officeFrameAssets(): Plugin {
  const source = fileURLToPath(new URL("../../packages/office-react/dist/", import.meta.url));
  let destination = "";
  return {
    name: "office-frame-assets",
    apply: "build",
    configResolved(config) {
      destination = resolve(config.root, config.build.outDir, "office");
    },
    writeBundle() {
      if (!existsSync(resolve(source, "frame.html")))
        throw new Error(
          "Office frame is missing. Run pnpm build to build workspace dependencies first.",
        );
      for (const fixture of [
        "artifact.html",
        "trace.html",
        "bootstrap.html",
        "bootstrap-frame.html",
      ]) {
        if (existsSync(resolve(source, fixture)))
          throw new Error(
            "Refusing to publish Office fixture pages. Rebuild the production frame.",
          );
      }
      cpSync(source, destination, { recursive: true });
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), officeFrameAssets()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
