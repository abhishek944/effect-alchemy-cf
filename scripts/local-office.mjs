import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const imageTag = "starter-office-local:dev";

/** @returns {string | undefined} Existing local image ID, or undefined when it is not built. */
function inspectLocalImage() {
  const inspected = spawnSync("docker", ["image", "inspect", imageTag, "--format", "{{.Id}}"], {
    cwd: root,
    encoding: "utf8",
  });
  if (inspected.error) throw inspected.error;
  if (inspected.status !== 0) return undefined;
  const image = inspected.stdout.trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image))
    throw new Error(`Could not inspect the local Office image ${imageTag}.`);
  return image;
}

/** Reuse the explicitly built local image; a backend start never rebuilds it. */
export function localOfficeImageRef() {
  const image = inspectLocalImage();
  if (image === undefined)
    throw new Error(
      `Local Office image ${imageTag} is not built. Start Docker, run pnpm dev:office once, then start pnpm dev.`,
    );
  return image;
}

/** Build locally; never push or pull an application image from a registry. */
export function buildLocalOfficeImage() {
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
        imageTag,
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
  const image = inspectLocalImage();
  if (image === undefined)
    throw new Error("Could not inspect the built local Office application image.");
  return image;
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const image = buildLocalOfficeImage();
  console.log(`Local Office image: ${image}`);
}
