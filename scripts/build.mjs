import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { appStage, buildEnvironment } from "../packages/config/stage.ts";

const result = spawnSync("pnpm", ["exec", "turbo", "run", "build", ...process.argv.slice(2)], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: buildEnvironment(appStage(process.env.APP_STAGE)),
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
