import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { buildAppConfig, stagePublicConfig } from "../../packages/config/stage.ts";

const backend = "http://localhost:1337";

/** Fixed local origins: the main UI and the separate admin UI. */
const mainPort = 5173;
const adminPort = 5175;

const app = buildAppConfig();
const stageConfig = stagePublicConfig();
const htmlEntities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const escapedName = app.name.replace(/[&<>"']/g, (value) => htmlEntities[value] ?? value);
const branding: Plugin = {
  name: "app-branding",
  transformIndexHtml: (html) => html.replaceAll("__APP_NAME__", () => escapedName),
};
/**
 * A local admin server links home to the main Vite origin; a built admin surface
 * uses the configured main domain. No admin host is invented here.
 */
function mainSiteUrl(admin: boolean, serve: boolean): string {
  if (!admin) return "";
  if (serve) return `http://localhost:${mainPort}`;
  return app.domain ? `https://${app.domain}` : "";
}
const revision = process.env["GITHUB_SHA"] ?? "";
const webRelease = /^[a-f0-9]{40}$/.test(revision) ? revision : `web-${Date.now().toString(36)}`;

export default defineConfig(({ mode, command }) => {
  const admin = mode === "admin";
  return {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(webRelease),
      PUBLIC_APP_CONFIG: JSON.stringify({ name: app.name }),
      // The admin surface is a separate build/origin; the main build never routes it.
      PUBLIC_APP_SURFACE: JSON.stringify(admin ? "admin" : "main"),
      PUBLIC_MAIN_SITE_URL: JSON.stringify(mainSiteUrl(admin, command === "serve")),
      // Public by design: only the stage publishable key reaches the bundle.
      PUBLIC_CLERK_PUBLISHABLE_KEY: JSON.stringify(stageConfig.clerkPublishableKey),
    },
    plugins: [tailwindcss(), react(), branding],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
    // Two servers share this root during local development; keep their caches apart.
    cacheDir: fileURLToPath(
      new URL(admin ? "./node_modules/.vite/admin" : "./node_modules/.vite/main", import.meta.url),
    ),
    server: {
      host: "localhost",
      port: admin ? adminPort : mainPort,
      strictPort: true,
      // Same-origin development: preserve the browser Host/Origin for auth and cookies.
      proxy: {
        "/api": { target: backend, ws: true },
      },
    },
  };
});
