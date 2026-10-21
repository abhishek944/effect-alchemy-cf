import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

// Build-time public binary/font data omitted from SDK1.0.3's published LaTeX UI bundle.
// No vendor JavaScript implementation is imported or patched. Image provenance checks profile agreement.
const resource = Object.freeze({
  version: "0.1.13",
  url: "https://registry.npmjs.org/ratex-wasm/-/ratex-wasm-0.1.13.tgz",
  integrity:
    "sha512-awHBCOv53XLgQHL3nI6Dqps3UclmTPx1KR7sNG3MJEolhUh28XUaTjAjqsm2JhU67RYKIT3QilWKZtAKu299SQ==",
});
const response = await fetch(resource.url, {
  redirect: "error",
  signal: AbortSignal.timeout(30000),
});
if (!response.ok || response.body === null) throw new Error("Render resource download failed.");
/** @type {Uint8Array[]} */
const chunks = [];
let length = 0;
for await (const chunk of response.body) {
  length += chunk.length;
  if (length > 8 * 1024 * 1024) throw new Error("Render resource archive exceeds build limit.");
  chunks.push(chunk);
}
const bytes = Buffer.concat(chunks);
const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
if (integrity !== resource.integrity) throw new Error("Render resource integrity mismatch.");
await mkdir("/resources", { recursive: true });
await writeFile("/resources/latex-assets.tgz", bytes);
execFileSync(
  "/bin/tar",
  [
    "--extract",
    "--gzip",
    "--file",
    "/resources/latex-assets.tgz",
    "--directory",
    "/resources",
    "package/pkg/ratex_wasm_bg.wasm",
    "package/fonts.css",
    "package/fonts",
  ],
  { env: { PATH: "/usr/bin:/bin" } },
);
await writeFile(
  "/resources/resource-identity.json",
  JSON.stringify({ ...resource, archiveSha256: createHash("sha256").update(bytes).digest("hex") }),
);
