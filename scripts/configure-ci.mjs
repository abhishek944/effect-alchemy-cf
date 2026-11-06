import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { authBaseURL, readAppConfig } from "../packages/config/public.ts";
import { serializeEnv } from "../packages/config/stage.ts";

if (
  process.env.CI !== "true" ||
  process.env.GITHUB_EVENT_NAME !== "push" ||
  process.env.GITHUB_REF !== "refs/heads/prod"
) {
  throw new Error("Production CI configuration is allowed only for pushes to prod in CI.");
}

const file = "packages/config/.env.prod";
const current = parseEnv(readFileSync(file, "utf8"));
const app = readAppConfig({
  APP_NAME: process.env.APP_NAME?.trim() || current.APP_NAME,
  APP_DOMAIN: process.env.APP_DOMAIN?.trim() ?? current.APP_DOMAIN,
});
const origin = authBaseURL(app, process.env.AUTH_BASE_URL ?? "");
const values = {
  ...current,
  APP_NAME: app.name,
  APP_DOMAIN: app.domain,
  DEV_ACCESS_EMAILS: "",
  AUTH_BASE_URL: origin,
  ALLOW_PRODUCTION: "true",
  CHAT_GATEWAY_ID: process.env.CHAT_GATEWAY_ID?.trim() ?? "",
  CHAT_MODEL_ALLOWLIST: process.env.CHAT_MODEL_ALLOWLIST?.trim() ?? "",
};
writeFileSync(file, serializeEnv(values), { mode: 0o600 });
process.stdout.write("Production CI environment configured.\n");
