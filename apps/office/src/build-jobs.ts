import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareOfficeFoundation } from "./build-foundation.ts";

const root = fileURLToPath(new URL("../../..", import.meta.url));
async function sources(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const item of await readdir(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) result.push(...(await sources(path)));
    else if (/\.(ts|mjs|css|html|md|json)$/.test(item.name) || item.name.startsWith("Dockerfile"))
      result.push(relative(root, join(root, path)));
  }
  return result;
}
const owned = (
  await Promise.all(
    [
      "apps/office/src",
      "apps/office/render",
      "packages/office-server/src/jobs",
      "packages/office-server/src/cli",
      "packages/office-server/src/ports",
      "packages/office-server/src/core",
      "packages/office-server/src/protocol",
      "packages/office-server/src/storage-remote",
      "packages/office-server/src/render-page",
      "packages/office-contract/src",
      "packages/diagnostics/src",
    ].map(sources),
  )
).flat();
const declarations = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.80.patch",
  "packages/office-server/package.json",
  "packages/office-contract/package.json",
  "packages/diagnostics/package.json",
];
const context = await prepareOfficeFoundation(join(root, "var/office/jobs-details/context"), {
  dockerfile: "Dockerfile.jobs",
  entries: {
    worker: join(root, "apps/office/src/worker.ts"),
    "native-bootstrap": join(root, "apps/office/src/native-bootstrap.ts"),
    "native-job-anchor": join(root, "apps/office/src/native-job-anchor.ts"),
    office: join(root, "apps/office/src/cli.ts"),
    server: join(root, "apps/office/src/server.ts"),
    "job-acceptance": join(root, "apps/office/src/job-acceptance.ts"),
  },
  sources: [
    ...new Set([
      ...owned,
      ...declarations,
      "apps/office/package.json",
      "apps/office/README.md",
      "apps/office/Dockerfile.jobs",
      "apps/office/image-profile.json",
      "apps/office/image-provenance.mjs",
      "apps/office/render-resources.mjs",
    ]),
  ].toSorted(),
});
console.log(JSON.stringify(context));
