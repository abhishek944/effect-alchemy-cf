import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
/** Build locally; never push or pull an application image from a registry. */
export function localOfficeImage() {
  /** @type {[string, string[]][]} */
  const commands = [
    ["pnpm", ["--filter", "@starter/office-runtime", "build:jobs:prepare"]],
    [
      "docker",
      [
        "build",
        "--platform",
        "linux/amd64",
        "--provenance=false",
        "--target",
        "application",
        "--tag",
        "starter-office-local:dev",
        "var/office/jobs-details/context",
      ],
    ],
  ];
  for (const [command, args] of commands) {
    const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0)
      throw new Error(`Local Office ${command} failed (${String(result.status)}).`);
  }
  const inspected = spawnSync(
    "docker",
    ["image", "inspect", "starter-office-local:dev", "--format", "{{.Id}}"],
    { cwd: root, encoding: "utf8" },
  );
  if (inspected.error) throw inspected.error;
  const image = inspected.stdout.trim();
  if (inspected.status !== 0 || !/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error("Could not inspect the built local Office application image.");
  return image;
}
