import { cpSync, existsSync, readFileSync } from "node:fs";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const backend = "http://localhost:1337";

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

const frameTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

/**
 * Serve the prebuilt Office frame from its owning package during Vite development.
 * The production build copies the same tree to dist/office; serving it here keeps the
 * iframe same-origin and authenticated without requiring apps/web/dist or a Worker restart.
 */
function officeFrameDev(): Plugin {
  const source = resolve(
    fileURLToPath(new URL("../../packages/office-react/dist/", import.meta.url)),
  );
  return {
    name: "office-frame-dev",
    apply: "serve",
    configureServer(server) {
      // Connect strips the "/office/" mount, so request.url is "/frame.html" or "/assets/…".
      server.middlewares.use("/office/", (request, response, next) => {
        const pathname = (request.url ?? "").split("?")[0] ?? "";
        const file = resolve(source, pathname.replace(/^\/+/, ""));
        const relativePath = relative(source, file);
        if (relativePath.length === 0 || relativePath.startsWith("..") || isAbsolute(relativePath))
          return next();
        let body: Buffer;
        try {
          body = readFileSync(file);
        } catch {
          if (relativePath === "frame.html") {
            response.statusCode = 503;
            response.setHeader("content-type", "text/plain; charset=utf-8");
            response.end(
              "Office frame is not built. Run: pnpm --filter @starter/office-react build:frame\n",
            );
            return;
          }
          return next();
        }
        response.setHeader("content-type", frameTypes[extname(file)] ?? "application/octet-stream");
        response.setHeader(
          "cache-control",
          relativePath.startsWith("assets/") ? "public, max-age=31536000, immutable" : "no-store",
        );
        response.end(body);
      });
    },
  };
}

const revision = process.env["GITHUB_SHA"] ?? "";
const webRelease = /^[a-f0-9]{40}$/.test(revision) ? revision : `web-${Date.now().toString(36)}`;

export default defineConfig({
  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(webRelease) },
  plugins: [tailwindcss(), react(), officeFrameAssets(), officeFrameDev()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    // Same-origin development: preserve the browser Host/Origin for auth and cookies.
    proxy: {
      "/api": { target: backend, ws: true },
      "/universer-api": { target: backend, ws: true },
    },
  },
});
