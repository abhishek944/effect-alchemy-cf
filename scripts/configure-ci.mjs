import { readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

if (
  process.env.CI !== "true" ||
  process.env.GITHUB_EVENT_NAME !== "push" ||
  process.env.GITHUB_REF !== "refs/heads/prod"
) {
  throw new Error("Production CI configuration is allowed only for pushes to prod in CI.");
}

const origin = process.env.AUTH_BASE_URL?.trim() ?? "";
const url = URL.canParse(origin) ? new URL(origin) : undefined;
if (origin && (url?.protocol !== "https:" || url.origin !== origin)) {
  throw new Error("AUTH_BASE_URL must be an HTTPS origin without a path or credentials.");
}
const file = "packages/config/.env.prod";
const values = {
  ...parseEnv(readFileSync(file, "utf8")),
  DEV_ACCESS_EMAILS: "",
  AUTH_BASE_URL: origin,
  ALLOW_PRODUCTION: "true",
};
writeFileSync(
  file,
  Object.entries(values)
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join("\n") + "\n",
  { mode: 0o600 },
);
process.stdout.write("Production CI environment configured.\n");
