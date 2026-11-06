import { spawnSync } from "node:child_process";
import { localOfficeImageRef } from "./local-office.mjs";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { readAppConfig } from "../packages/config/public.ts";
import { speechProfileEnvironment } from "./speech-profile.mjs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.argv.length !== 2) throw new Error("Usage: node scripts/local.mjs");
const require = createRequire(new URL("../apps/infra/package.json", import.meta.url));
const loader = fileURLToPath(
  new URL("../bin/register-oxc.js", pathToFileURL(require.resolve("alchemy"))),
);
const configuration = parseEnv(
  readFileSync(new URL("../packages/config/.env.dev", import.meta.url), "utf8"),
);
const app = readAppConfig(configuration);
const speech = speechProfileEnvironment("default", "dev_local");
/** @type {NodeJS.ProcessEnv} */
const childEnvironment = {
  ...process.env,
  ...speech,
  APP_NAME: app.name,
  APP_DOMAIN: "",
  CHAT_MODEL_ALLOWLIST: configuration.CHAT_MODEL_ALLOWLIST ?? "",
  CHAT_GATEWAY_ID: configuration.CHAT_GATEWAY_ID ?? "",
  AUTH_BASE_URL: "",
  ALLOW_PRODUCTION: "false",
  ALCHEMY_DEV: "true",
  OFFICE_IMAGE_REF: localOfficeImageRef(),
};
if (!existsSync(new URL("../apps/web/dist/index.html", import.meta.url)))
  console.log(
    "No apps/web/dist build: the Worker serves API only. Run pnpm dev:web and open http://localhost:5173.",
  );
const result = spawnSync(
  process.execPath,
  ["--import", loader, fileURLToPath(new URL("../apps/infra/local.ts", import.meta.url))],
  {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: childEnvironment,
    stdio: "inherit",
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
