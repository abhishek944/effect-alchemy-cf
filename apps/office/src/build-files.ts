import { createHash } from "node:crypto";
import { access, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { createRequire } from "node:module";
import { Schema } from "effect";

export const stringRecord = Schema.Record(Schema.String, Schema.String);

/** Resolve only exported CSS data from the declared Render Page dependency owner. */
export function nativeStyleAliases(serverManifest: string): Record<string, string> {
  const renderEntry = createRequire(serverManifest).resolve("@univer-cli/univer-render-page");
  const sdk = createRequire(renderEntry);
  return Object.fromEntries(
    [
      "@univerjs/design/lib/index.css",
      "@univerjs/ui/lib/index.css",
      "@univerjs/sheets-ui/lib/index.css",
      "@univerjs/docs-ui/lib/index.css",
      "@univerjs-pro/slides-ui/lib/index.css",
    ].map((specifier) => [specifier, sdk.resolve(specifier)]),
  );
}
export async function readJson(path: string): Promise<unknown> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  return value;
}

export async function describeRenderAssetGap(serverManifest: string, assetVersion: string) {
  const server = createRequire(serverManifest);
  const renderEntry = server.resolve("@univer-cli/univer-render-page");
  const publicEntry = createRequire(renderEntry).resolve("@univerjs-pro/docs-latex-ui");
  const root = resolve(dirname(publicEntry), "../..");
  const metadata = Schema.decodeUnknownSync(
    Schema.Struct({
      name: Schema.String,
      version: Schema.String,
      devDependencies: stringRecord,
      exports: Schema.Struct({ ".": Schema.Struct({ import: Schema.String }) }),
    }),
  )(await readJson(join(root, "package.json")));
  const entry = join(root, metadata.exports["."].import);
  if (
    metadata.name !== "@univerjs-pro/docs-latex-ui" ||
    metadata.version !== "1.0.3" ||
    metadata.devDependencies["ratex-wasm"] !== assetVersion ||
    !(await readFile(entry, "utf8")).includes("ratex_wasm_bg.wasm")
  ) {
    throw new Error(
      "Pinned SDK render-resource ABI evidence changed; reevaluate the asset workaround.",
    );
  }
  let adjacentAsset = false;
  try {
    await access(join(dirname(entry), "ratex_wasm_bg.wasm"));
    adjacentAsset = true;
  } catch {
    /* Published omission. */
  }
  if (adjacentAsset)
    throw new Error(
      "SDK now ships its WASM asset; remove the workaround and verify native rendering.",
    );
  return {
    sdkPackage: metadata.name,
    sdkVersion: metadata.version,
    sdkEntrySha256: await sha256(entry),
    declaredRatexBuildVersion: assetVersion,
    referencesWasm: true,
    adjacentWasmAbsent: true,
    removalCondition:
      "Remove external asset stage when the pinned SDK ships compatible WASM/fonts; rebuild and verify real native rendering.",
  };
}

export async function sha256(path: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
}

export async function copyDeclaration(
  root: string,
  destination: string,
  path: string,
): Promise<void> {
  await mkdir(dirname(join(destination, path)), { recursive: true });
  await writeFile(join(destination, path), await readFile(join(root, path)));
}

export async function describeFiles(
  root: string,
  directory = root,
): Promise<
  {
    readonly path: string;
    readonly sha256: string;
    readonly bytes: number;
  }[]
> {
  const result: { path: string; sha256: string; bytes: number }[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await describeFiles(root, path)));
    else if (entry.isFile()) {
      const bytes = await readFile(path);
      result.push({
        path: relative(root, path),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        bytes: bytes.length,
      });
      if (
        path.endsWith(".mjs") &&
        /(?:from\s*|import\s*\()\s*["']@starter\//u.test(bytes.toString("utf8"))
      ) {
        throw new Error("Private TypeScript package escaped Node bundling.");
      }
    } else throw new Error("Build context must not contain links or non-file entries.");
  }
  return result.toSorted((a, b) => a.path.localeCompare(b.path));
}
