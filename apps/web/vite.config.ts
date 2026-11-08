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
 * The admin dev origin is admin-only: document navigations outside /admin become
 * /admin, so its root opens the portal. Assets, HMR and proxied /api are untouched,
 * and the app keeps its single production path.
 */
const adminSurface: Plugin = {
  name: "admin-surface",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((request, response, next) => {
      const navigation =
        request.method === "GET" && (request.headers.accept ?? "").includes("text/html");
      const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
      // Portal pages and proxied API responses keep their own paths.
      const portal = pathname === "/admin" || pathname.startsWith("/admin/");
      if (!navigation || portal || pathname.startsWith("/api/")) return next();
      response.writeHead(302, { location: "/admin" });
      response.end();
    });
  },
};
const revision = process.env["GITHUB_SHA"] ?? "";
const webRelease = /^[a-f0-9]{40}$/.test(revision) ? revision : `web-${Date.now().toString(36)}`;

export default defineConfig(({ mode }) => {
  const admin = mode === "admin";
  return {
    define: {
      "import.meta.env.VITE_APP_VERSION": JSON.stringify(webRelease),
      PUBLIC_APP_CONFIG: JSON.stringify({ name: app.name }),
      // The local admin origin links home to the main UI; blank elsewhere.
      PUBLIC_ADMIN_HOME_URL: JSON.stringify(admin ? `http://localhost:${mainPort}` : ""),
      // Public by design: only the stage publishable key reaches the bundle.
      PUBLIC_CLERK_PUBLISHABLE_KEY: JSON.stringify(stageConfig.clerkPublishableKey),
    },
    plugins: [tailwindcss(), react(), branding, ...(admin ? [adminSurface] : [])],
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
