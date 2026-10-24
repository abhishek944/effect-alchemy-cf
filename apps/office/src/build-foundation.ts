import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, resolve, sep } from "node:path";
import { build } from "vite";
import { Schema } from "effect";
import {
  copyDeclaration,
  describeFiles,
  describeRenderAssetGap,
  nativeStyleAliases,
  readJson,
  sha256,
  stringRecord,
} from "./build-files.ts";

const repository = fileURLToPath(new URL("../../..", import.meta.url));
const application = join(repository, "apps/office");
const allowedOutput = join(repository, "var/office/runtime-image-details");
const declarations = [
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "patches/@alchemy.run__cloudflare-runtime@2.0.0-beta.80.patch",
  "packages/office-server/package.json",
  "packages/office-contract/package.json",
  "packages/diagnostics/package.json",
];

/** Explicit local preparation only. No install, daemon action, environment file or host checkout COPY. */
export async function prepareOfficeFoundation(
  destination = join(allowedOutput, "context"),
  composition: {
    readonly entries?: Readonly<Record<string, string>>;
    readonly sources?: readonly string[];
    readonly dockerfile?: "Dockerfile" | "Dockerfile.jobs";
  } = {},
) {
  const output = resolve(destination);
  const roots = [allowedOutput, join(repository, "var/office/jobs-details")];
  if (!roots.some((root) => output.startsWith(`${root}${sep}`) && output !== root)) {
    throw new Error("Office image context must remain in its owned artifact directory.");
  }
  const lockDigest = await sha256(join(repository, "pnpm-lock.yaml"));
  const server = Schema.decodeUnknownSync(Schema.Struct({ dependencies: stringRecord }))(
    await readJson(join(repository, "packages/office-server/package.json")),
  );
  const profile = Schema.decodeUnknownSync(stringRecord)(
    await readJson(join(application, "image-profile.json")),
  );
  if (profile.platform !== "linux/amd64" || profile.sdkVersion !== "1.0.3")
    throw new Error("Unsupported image profile.");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await build({
    root: join(application, "render"),
    resolve: { alias: nativeStyleAliases(join(repository, "packages/office-server/package.json")) },
    configFile: false,
    envDir: false,
    envPrefix: "__OFFICE_NO_PUBLIC_ENV_",
    publicDir: false,
    base: "./",
    build: {
      outDir: join(output, "render-page"),
      emptyOutDir: true,
      target: "es2022",
      minify: false,
      cssMinify: false,
      sourcemap: false,
      reportCompressedSize: false,
    },
  });
  await build({
    root: application,
    configFile: false,
    envDir: false,
    publicDir: false,
    envPrefix: "__OFFICE_NO_PUBLIC_ENV_",
    ssr: {
      noExternal: [/^@starter\//u],
      external: Object.keys(server.dependencies).filter((name) => !name.startsWith("@starter/")),
    },
    build: {
      ssr: true,
      target: "node22",
      outDir: join(output, "node"),
      emptyOutDir: true,
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      rolldownOptions: {
        external: Object.keys(server.dependencies).filter((name) => !name.startsWith("@starter/")),
        input: composition.entries ?? {
          "foundation-smoke": join(application, "src/foundation-smoke.ts"),
          "runtime-foundation": join(repository, "packages/office-server/src/jobs/index.ts"),
        },
        output: { entryFileNames: "[name].mjs", chunkFileNames: "chunks/[name]-[hash].mjs" },
      },
    },
  });
  for (const path of declarations)
    await copyDeclaration(repository, join(output, "dependency-root"), path);
  for (const path of ["Dockerfile", "image-provenance.mjs", "render-resources.mjs"]) {
    const source = path === "Dockerfile" ? (composition.dockerfile ?? path) : path;
    await writeFile(join(output, path), await readFile(join(application, source)));
  }
  const sourceFiles = composition.sources ?? [
    "apps/office/package.json",
    "apps/office/README.md",
    "apps/office/image-profile.json",
    "apps/office/Dockerfile",
    "apps/office/image-provenance.mjs",
    "apps/office/render-resources.mjs",
    "apps/office/src/build-foundation.ts",
    "apps/office/src/build-files.ts",
    "apps/office/src/foundation-smoke.ts",
    "apps/office/src/foundation-samples.ts",
    "apps/office/src/verify-foundation.ts",
    "apps/office/src/verify-run.ts",
    "apps/office/render/main.ts",
    "apps/office/render/styles.css",
    "apps/office/render/index.html",
    "packages/office-server/src/jobs/index.ts",
    "packages/office-server/src/jobs/runtime-factory.ts",
    "packages/office-server/src/jobs/renderer.ts",
    "packages/office-server/src/render-page/index.ts",
    ...declarations,
  ];
  const sources = await Promise.all(
    sourceFiles.map(async (path) => ({ path, sha256: await sha256(join(repository, path)) })),
  );
  const artifacts = await describeFiles(output);
  const sdkAssetGap = await describeRenderAssetGap(
    join(repository, "packages/office-server/package.json"),
    profile.latexAssetVersion ?? "",
  );
  if ((await sha256(join(repository, "pnpm-lock.yaml"))) !== lockDigest)
    throw new Error("Parent lockfile changed during preparation; rebuild context.");
  await writeFile(
    join(output, "provenance-source.json"),
    JSON.stringify(
      { profile, rootLockSha256: lockDigest, sources, artifacts, sdkAssetGap },
      null,
      2,
    ),
  );
  await writeFile(join(output, ".dockerignore"), "**/.env*\n**/.npmrc\n**/.git\n**/node_modules\n");
  return { directory: output, profile, rootLockSha256: lockDigest, files: artifacts.length };
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  if (process.argv.length > 3)
    throw new Error(
      "Usage: node --experimental-strip-types src/build-foundation.ts [owned-output-directory]",
    );
  console.log(JSON.stringify(await prepareOfficeFoundation(process.argv[2])));
}
