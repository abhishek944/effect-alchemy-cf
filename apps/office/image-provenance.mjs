import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { Schema } from "effect";

const require = createRequire(import.meta.url);
/** @param {string} path */
const hash = async (path) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
/** @param {string} path @returns {Promise<unknown>} */
async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}
const source = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))(
  await json("/opt/office/provenance-source.json"),
);
const profile = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.String))(
  source.profile,
);
if (process.platform !== "linux" || process.arch !== "x64")
  throw new Error("Image is not Linux/amd64.");
if (process.version !== `v${profile.nodeVersion}`)
  throw new Error("Node version differs from image profile.");
/** @param {string} root @returns {Promise<string[]>} */
async function files(root) {
  /** @type {string[]} */
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}
/** @param {string} name @returns {Promise<string>} */
async function packageVersion(name) {
  let directory = dirname(require.resolve(name));
  for (let level = 0; level < 6; level++) {
    try {
      const metadata = Schema.decodeUnknownSync(
        Schema.Struct({ name: Schema.String, version: Schema.String }),
      )(await json(join(directory, "package.json")));
      if (metadata.name === name) return metadata.version;
    } catch {
      /* Public module entry may be nested below its metadata. */
    }
    directory = dirname(directory);
  }
  throw new Error(`Missing public package metadata: ${name}`);
}
/** @type {Record<string, string>} */
const sdk = {};
for (const name of [
  "@univerjs/core",
  "@univer-cli/headless-univer",
  "@univer-cli/univer-render-runtime",
  "@univerjs-pro/exchange-node",
]) {
  sdk[name] = await packageVersion(name);
  if (sdk[name] !== profile.sdkVersion) throw new Error("SDK cohort differs from pinned profile.");
}
/** @type {{path: string, sha256: string, bytes: number}[]} */
const nativeBindings = [];
const store = "/opt/office/dependencies/node_modules/.pnpm";
for (const name of await readdir(store)) {
  if (!/^@univerjs-pro\+(?:engine-formula-rust|exchange-node)-binding-linux-x64-gnu@/.test(name))
    continue;
  for (const path of await files(join(store, name))) {
    if (!path.endsWith(".node")) continue;
    const bytes = await readFile(path);
    if (bytes.subarray(0, 4).toString("hex") !== "7f454c46" || bytes.readUInt16LE(18) !== 62) {
      throw new Error("Native binding is not an x86-64 ELF artifact.");
    }
    nativeBindings.push({
      path: path.slice(store.length + 1),
      sha256: await hash(path),
      bytes: bytes.length,
    });
  }
}
if (nativeBindings.length !== 2)
  throw new Error("Linux native Formula/Exchange bindings are missing.");
/** @type {{path: string, sha256: string}[]} */
const fonts = [];
for (const root of ["/usr/share/fonts", "/opt/office/render-page/assets/fonts"]) {
  for (const path of await files(root)) {
    if (/\.(?:ttf|otf|woff2?)$/i.test(path)) fonts.push({ path, sha256: await hash(path) });
  }
}
if (fonts.length === 0) throw new Error("No packaged fonts.");
const installed = execFileSync(
  "/usr/bin/dpkg-query",
  ["-W", "-f=${Package}=${Version}\n", "chromium", "fonts-dejavu-core", "fonts-liberation"],
  { env: { PATH: "/usr/bin:/bin" }, encoding: "utf8" },
);
for (const [name, version] of [
  ["chromium", profile.chromiumVersion],
  ["fonts-dejavu-core", profile.dejavuVersion],
  ["fonts-liberation", profile.liberationVersion],
]) {
  if (!installed.includes(`${name}=${version}\n`))
    throw new Error(`Package version mismatch: ${name}`);
}
const identity = Schema.decodeUnknownSync(
  Schema.Struct({
    version: Schema.String,
    url: Schema.String,
    integrity: Schema.String,
    archiveSha256: Schema.String,
  }),
)(await json("/opt/office/render-resource-identity.json"));
if (
  identity.version !== profile.latexAssetVersion ||
  identity.url !== profile.latexAssetUrl ||
  identity.integrity !== profile.latexAssetIntegrity
)
  throw new Error("Render-resource profile mismatch.");
process.stdout.write(
  JSON.stringify(
    {
      ...source,
      sdkVersion: profile.sdkVersion,
      sdk,
      platform: `${process.platform}/${process.arch}`,
      node: process.version,
      browser: {
        package: installed.split("\n").find((line) => line.startsWith("chromium=")),
        binarySha256: await hash("/usr/lib/chromium/chromium"),
        launcherSha256: await hash("/usr/bin/chromium"),
      },
      installedPackages: installed.trim().split("\n"),
      nativeBindings,
      renderResources: {
        identity,
        wasmSha256: await hash("/opt/office/render-page/assets/ratex_wasm_bg.wasm"),
        fontCssSha256: await hash("/opt/office/render-page/assets/fonts.css"),
      },
      fonts,
    },
    null,
    2,
  ),
);
