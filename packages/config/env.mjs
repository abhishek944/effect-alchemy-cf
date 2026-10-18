import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const defaults = {
  DEV_ACCESS_EMAILS: "",
  AUTH_BASE_URL: "",
  ALLOW_PRODUCTION: "false",
  CHAT_GATEWAY_ID: "",
  CHAT_MODEL_ALLOWLIST: "",
  BILLING_PROVIDER: "",
  BILLING_PRODUCTS: "{}",
  DODO_ACCOUNT_ID: "",
  POLAR_ACCOUNT_ID: "",
};
const files = ["dev", "prod"].map((stage) => new URL(`.env.${stage}`, import.meta.url));
const template = [
  "# Private stage configuration; provider credentials belong in Alchemy profiles.",
  "# Blank AUTH_BASE_URL uses the Worker origin; Alchemy determines execution mode.",
  ...Object.entries(defaults).map(([key, value]) => `${key}=${value}`),
  "",
].join("\n");

if (process.argv.includes("--init")) {
  for (const file of files) {
    if (!existsSync(file)) {
      writeFileSync(file, template, { flag: "wx", mode: 0o600 });
    } else {
      const content = readFileSync(file, "utf8");
      const current = parseEnv(content);
      const missing = Object.entries(defaults).filter(([key]) => !(key in current));
      if (missing.length > 0) {
        const additions = missing
          .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
          .join("\n");
        writeFileSync(file, `${content.trimEnd()}\n${additions}\n`, { mode: 0o600 });
      }
    }
  }
}

const keySets = files.map((file) => {
  if (!existsSync(file)) throw new Error("Missing stage env file; run pnpm install to initialize.");
  return Object.keys(parseEnv(readFileSync(file, "utf8"))).toSorted();
});
const expected = Object.keys(defaults);
const first = keySets[0];
if (
  first === undefined ||
  keySets.some(
    (keys) =>
      JSON.stringify(keys) !== JSON.stringify(first) || expected.some((key) => !keys.includes(key)),
  )
) {
  throw new Error(
    "Stage env files must have identical keys and include all shared configuration keys.",
  );
}
process.stdout.write("Stage env files have matching configuration keys.\n");
