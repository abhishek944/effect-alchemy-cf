import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const vite = fileURLToPath(
  new URL("./bin/vite.js", pathToFileURL(require.resolve("vite/package.json"))),
);
const root = fileURLToPath(new URL("../apps/web/", import.meta.url));

console.log("Main UI : http://localhost:5173");
console.log("Admin UI: http://localhost:5175 (opens /admin)");

// Fixed ports from apps/web/vite.config.ts; strictPort fails instead of drifting.
const main = spawn(process.execPath, [vite], { cwd: root, env: process.env, stdio: "inherit" });
// Only the main server reads the terminal, so Vite shortcuts have one owner.
const admin = spawn(process.execPath, [vite, "--mode", "admin"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "inherit", "inherit"],
});
const children = [main, admin];
const stop = () => {
  for (const child of children) child.kill("SIGTERM");
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const exitOf = (child: (typeof children)[number]): Promise<number> =>
  new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });

try {
  // Either server exiting (occupied port or Ctrl+C) stops both.
  process.exitCode = await Promise.race(children.map(exitOf));
} finally {
  stop();
  process.off("SIGINT", stop);
  process.off("SIGTERM", stop);
}
