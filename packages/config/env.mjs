import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";

const defaults = {
  DEV_ACCESS_EMAILS: "",
  AUTH_BASE_URL: "",
  ALLOW_PRODUCTION: "false",
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
    if (!existsSync(file)) writeFileSync(file, template, { flag: "wx", mode: 0o600 });
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
