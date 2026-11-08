import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { stageDefaults } from "./defaults.ts";
import { authBaseURL, readAppConfig } from "./public.ts";
import { appStage, serializeEnv, stageEnvFile } from "./stage.ts";

const files = (["dev", "prod"] as const).map((stage) => ({
  file: stageEnvFile(stage),
  defaults: stageDefaults(appStage(stage)),
}));

if (process.argv.includes("--init")) {
  for (const { file, defaults } of files) {
    if (!existsSync(file)) {
      const template = [
        "# Private stage configuration; provider credentials are never committed.",
        "# APP_DOMAIN selects the public hostname; blank AUTH_BASE_URL follows that origin.",
        serializeEnv(defaults),
      ].join("\n");
      writeFileSync(file, template, { flag: "wx", mode: 0o600 });
    } else {
      const content = readFileSync(file, "utf8");
      const current = parseEnv(content);
      const missing = Object.entries(defaults).filter(([key]) => !(key in current));
      if (missing.length > 0) {
        const additions = serializeEnv(Object.fromEntries(missing));
        writeFileSync(file, `${content.trimEnd()}\n${additions}`, { mode: 0o600 });
      }
    }
  }
}

const hosts: string[] = [];
const keySets = files.map(({ file }) => {
  if (!existsSync(file)) throw new Error("Missing stage env file; run pnpm install to initialize.");
  const values = parseEnv(readFileSync(file, "utf8"));
  authBaseURL(readAppConfig(values), values.AUTH_BASE_URL ?? "");
  const host = values.CHAT_HOST_URL ?? "";
  if (host) {
    let origin: URL;
    try {
      origin = new URL(host);
    } catch {
      throw new Error("CHAT_HOST_URL must be a private HTTPS origin, or blank.");
    }
    if (
      origin.protocol !== "https:" ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== "/"
    )
      throw new Error("CHAT_HOST_URL must be a private HTTPS origin, or blank.");
    hosts.push(origin.origin);
  }
  return Object.keys(values).toSorted();
});
const expected = Object.keys(stageDefaults("dev"));
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
if (hosts.length === 2 && hosts[0] === hosts[1])
  throw new Error("Development and production must use separate Pi host origins.");
process.stdout.write("Stage env files have matching keys and valid public app configuration.\n");
