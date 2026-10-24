import { spawnSync } from "node:child_process";
import { localOfficeImageRef } from "./local-office.mjs";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { billingProfileEnvironment } from "./billing-profile.mjs";
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
const billingConfig = Object.fromEntries(
  Object.entries(configuration).filter(([key]) =>
    ["BILLING_PROVIDER", "BILLING_PRODUCTS", "DODO_ACCOUNT_ID", "POLAR_ACCOUNT_ID"].includes(key),
  ),
);
const billing = billingProfileEnvironment("default", "local", billingConfig);
const speech = speechProfileEnvironment("default", "dev_local");
/** @type {NodeJS.ProcessEnv} */
const childEnvironment = {
  ...process.env,
  ...billingConfig,
  ...billing,
  ...speech,
  CHAT_MODEL_ALLOWLIST: configuration.CHAT_MODEL_ALLOWLIST ?? "",
  CHAT_GATEWAY_ID: configuration.CHAT_GATEWAY_ID ?? "",
  AUTH_BASE_URL: "",
  ALLOW_PRODUCTION: "false",
  ALCHEMY_DEV: "true",
  OFFICE_IMAGE_REF: localOfficeImageRef(),
};
delete childEnvironment.BILLING_ENVIRONMENT;
delete childEnvironment.BILLING_NAMESPACE;
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
