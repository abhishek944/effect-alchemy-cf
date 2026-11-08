import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { readAppConfig } from "../packages/config/public.ts";
import { stageEnvFile, stagePublicConfig } from "../packages/config/stage.ts";
import { startLocalChatHost } from "./local-chat-host.ts";
import { speechProfileEnvironment } from "./speech-profile.ts";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/local.ts");

const configuration = parseEnv(readFileSync(stageEnvFile("dev"), "utf8"));
const app = readAppConfig(configuration);
const speech = speechProfileEnvironment("default", "dev_local");
const childEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  ...speech,
  APP_NAME: app.name,
  APP_DOMAIN: "",
  AUTH_BASE_URL: "",
  CHAT_MODEL_ALLOWLIST: configuration.CHAT_MODEL_ALLOWLIST ?? "",
  // Public by design; a blank publishable key simply disables browser sign-in.
  CLERK_PUBLISHABLE_KEY: stagePublicConfig("dev").clerkPublishableKey,
};
if (!existsSync(new URL("../apps/web/dist/index.html", import.meta.url)))
  console.log(
    "No apps/web/dist build: the API runs alone. Run pnpm dev:web and open the main UI at http://localhost:5173 or the admin UI at http://localhost:5175.",
  );

const host = await startLocalChatHost();
const api = spawn(
  process.execPath,
  [
    "--experimental-strip-types",
    fileURLToPath(new URL("../apps/api/src/server.ts", import.meta.url)),
  ],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...childEnvironment, ...host.environment },
    stdio: "inherit",
  },
);
const stop = () => {
  api.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
host.onExit(stop);
try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    api.once("error", reject);
    api.once("exit", (code) => resolve(code ?? 1));
  });
} finally {
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
  await host.close();
}
