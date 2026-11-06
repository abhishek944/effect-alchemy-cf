import { spawnSync } from "node:child_process";
import { buildEnvironment } from "../packages/config/stage.ts";
import { speechProfileEnvironment } from "./speech-profile.mjs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const [command, stage, ...flags] = process.argv.slice(2);
if (
  (command !== "plan" && command !== "deploy") ||
  (stage !== "dev" && stage !== "prod") ||
  flags.length > 1 ||
  (flags.length === 1 && (command !== "deploy" || flags[0] !== "--yes"))
) {
  throw new Error("Usage: node scripts/cloud.mjs <plan|deploy> <dev|prod> [--yes for deploy]");
}
const require = createRequire(new URL("../apps/infra/package.json", import.meta.url));
const cli = fileURLToPath(new URL("../bin/cli.js", pathToFileURL(require.resolve("alchemy"))));
const profile = stage === "prod" ? "prod" : "default";
const buildEnv = buildEnvironment(stage);
for (const check of ["lint", "build"]) {
  const checked = spawnSync("pnpm", [check], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: buildEnv,
    stdio: "inherit",
  });
  if (checked.error) throw checked.error;
  if (checked.status !== 0) process.exit(checked.status ?? 1);
}
const speech = speechProfileEnvironment(profile, stage);
/** @type {NodeJS.ProcessEnv} */
const childEnvironment = { ...buildEnv, ...speech };
const result = spawnSync(
  process.execPath,
  [
    cli,
    command,
    "--stage",
    stage,
    "--profile",
    profile,
    "--env-file",
    fileURLToPath(new URL(`../packages/config/.env.${stage}`, import.meta.url)),
    ...flags,
  ],
  {
    cwd: fileURLToPath(new URL("../apps/infra/", import.meta.url)),
    stdio: "inherit",
    env: childEnvironment,
  },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
