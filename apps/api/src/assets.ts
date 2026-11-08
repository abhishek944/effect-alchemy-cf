import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { Effect } from "effect";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
};

/** Resolve inside the build directory, or nothing: a request never escapes it. */
const resolve = (root: string, pathname: string): string | null => {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const absolute = normalize(join(root, decoded));
  return absolute === root || absolute.startsWith(`${root}${sep}`) ? absolute : null;
};

const read = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(await readFile(path));
  } catch {
    return null;
  }
};

/**
 * Serves the built single-page app. An unknown path returns `index.html` so the
 * browser router owns deep links, exactly as the previous asset binding did.
 */
export const serveAssets = (root: string) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const pathname = request.url.split("?")[0] ?? "/";
    const candidate = resolve(root, pathname);
    const bytes = candidate === null ? null : yield* Effect.promise(() => read(candidate));
    if (bytes !== null && candidate !== null) {
      return HttpServerResponse.uint8Array(bytes, {
        contentType: CONTENT_TYPES[extname(candidate).toLowerCase()] ?? "application/octet-stream",
      });
    }
    const index = yield* Effect.promise(() => read(join(root, "index.html")));
    // Without a build the API still runs; say so instead of returning a bare 404.
    if (index === null)
      return HttpServerResponse.text(
        "No web build found. Run `pnpm build` or `pnpm dev:web` and open the Vite origin.",
        { status: 404 },
      );
    return HttpServerResponse.uint8Array(index, {
      contentType: CONTENT_TYPES[".html"] ?? "text/html; charset=utf-8",
      headers: { "cache-control": "no-cache" },
    });
  });
