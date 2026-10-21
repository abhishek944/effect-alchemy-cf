/**
 * Browser mirror of the server's filename allowlist and content policy.
 *
 * The server remains authoritative; this module exists so picker/paste/drop
 * validation matches it deterministically. Classification is by the exact
 * filename extension only — an operating-system MIME guess (.ts as video/mp2t,
 * .js as application/javascript, .yaml as application/yaml) is never trusted.
 * Content is still validated: fatal UTF-8 with the control policy for text, real
 * image signatures for JPEG/PNG/WebP, and bounded OOXML structure for Office.
 */
import type { FileKind } from "@/lib/chat-capability-file-types";
import { officeMediaType } from "@/lib/chat-office-media";

export type ResolvedMedia = { readonly kind: FileKind; readonly mediaType: string };

// Exact mirror of apps/api/src/chat-files-media.ts TEXT_TYPES.
const TEXT_TYPES: Readonly<Record<string, string>> = {
  txt: "text/plain",
  log: "text/plain",
  ini: "text/plain",
  cfg: "text/plain",
  conf: "text/plain",
  properties: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  yml: "text/yaml",
  yaml: "text/yaml",
  toml: "text/toml",
  xml: "text/xml",
  html: "text/html",
  htm: "text/html",
  css: "text/css",
  scss: "text/scss",
  less: "text/less",
  js: "text/javascript",
  mjs: "text/javascript",
  cjs: "text/javascript",
  jsx: "text/javascript",
  ts: "text/typescript",
  tsx: "text/typescript",
  mts: "text/typescript",
  cts: "text/typescript",
  py: "text/x-python",
  rb: "text/x-ruby",
  go: "text/x-go",
  rs: "text/x-rust",
  java: "text/x-java",
  kt: "text/x-kotlin",
  kts: "text/x-kotlin",
  swift: "text/x-swift",
  c: "text/x-c",
  h: "text/x-c",
  cpp: "text/x-c++",
  cc: "text/x-c++",
  cxx: "text/x-c++",
  hpp: "text/x-c++",
  hh: "text/x-c++",
  cs: "text/x-csharp",
  php: "text/x-php",
  sh: "text/x-sh",
  bash: "text/x-sh",
  zsh: "text/x-sh",
  sql: "text/x-sql",
  lua: "text/x-lua",
  dart: "text/x-dart",
  scala: "text/x-scala",
  clj: "text/x-clojure",
  cljs: "text/x-clojure",
  ex: "text/x-elixir",
  exs: "text/x-elixir",
  erl: "text/x-erlang",
  hrl: "text/x-erlang",
  fs: "text/x-fsharp",
  vb: "text/x-vb",
  pl: "text/x-perl",
  r: "text/x-r",
  jl: "text/x-julia",
  vue: "text/x-vue",
  svelte: "text/x-svelte",
  graphql: "text/x-graphql",
  gql: "text/x-graphql",
  tex: "text/x-tex",
  diff: "text/x-diff",
  patch: "text/x-diff",
};

// Exact mirror of the server IMAGE_TYPES (extension -> format/media type).
const IMAGE_TYPES: Readonly<
  Record<string, { format: "jpeg" | "png" | "webp"; mediaType: string }>
> = {
  jpg: { format: "jpeg", mediaType: "image/jpeg" },
  jpeg: { format: "jpeg", mediaType: "image/jpeg" },
  png: { format: "png", mediaType: "image/png" },
  webp: { format: "webp", mediaType: "image/webp" },
};

export const resolveMedia = (name: string): ResolvedMedia | null => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  const image = IMAGE_TYPES[extension];
  if (image !== undefined) return { kind: "image", mediaType: image.mediaType };
  const office = officeMediaType(extension);
  if (office !== null) return { kind: "office", mediaType: office };
  const text = TEXT_TYPES[extension];
  return text === undefined ? null : { kind: "text", mediaType: text };
};

export const imageFormatFor = (mediaType: string): "jpeg" | "png" | "webp" | null =>
  Object.values(IMAGE_TYPES).find((entry) => entry.mediaType === mediaType)?.format ?? null;

/** All allowlisted extensions, so the picker offers every allowed code type. */
export const ALLOWED_EXTENSIONS: readonly string[] = [
  ...Object.keys(IMAGE_TYPES),
  ...Object.keys(TEXT_TYPES),
  "xlsx",
  "docx",
  "pptx",
];

const allowedCode = (code: number): boolean => {
  if (code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d) return true;
  if (code < 0x20 || code === 0x7f) return false;
  if (code >= 0x80 && code <= 0x9f) return false;
  if (code === 0xfffe || code === 0xffff) return false;
  if (code >= 0xfdd0 && code <= 0xfdef) return false;
  return true;
};

const textStart = (bytes: Uint8Array): number | null => {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return 3;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return null;
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return null;
  return 0;
};

export type DecodedText =
  | { readonly ok: true; readonly text: string; readonly chars: number; readonly excerpt: string }
  | { readonly ok: false };

/** Fatal UTF-8 decode with the same control policy and exact-prefix excerpt. */
export const decodeTextFile = (bytes: Uint8Array, excerptLimit: number): DecodedText => {
  const start = textStart(bytes);
  if (start === null) return { ok: false };
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(
      bytes.subarray(start),
    );
  } catch {
    return { ok: false };
  }
  let chars = 0;
  let excerpt = "";
  let collecting = true;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (!allowedCode(code)) return { ok: false };
    chars += 1;
    if (collecting && excerpt.length + character.length <= excerptLimit) excerpt += character;
    else collecting = false;
  }
  if (excerpt.length > excerptLimit) return { ok: false };
  return { ok: true, text, chars, excerpt };
};

const SIGNATURE = {
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  riff: [0x52, 0x49, 0x46, 0x46],
  webp: [0x57, 0x45, 0x42, 0x50],
} as const;

const hasBytes = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean => {
  if (offset + expected.length > bytes.byteLength) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
};

/** Full binary image signatures; text extensions must not contain image bytes. */
export const hasImageSignature = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
  hasBytes(bytes, 0, SIGNATURE.png) ||
  (hasBytes(bytes, 0, SIGNATURE.riff) && hasBytes(bytes, 8, SIGNATURE.webp));
