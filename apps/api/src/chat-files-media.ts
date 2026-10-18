/**
 * Filename-to-media allowlist and actual content validation.
 *
 * Extension and bytes must agree: a declared MIME type or filename alone is not
 * evidence of content. JPEG/PNG/WebP are parsed structurally; text/code must be
 * valid UTF-8 within the control policy. Nothing is resized, truncated or
 * re-interpreted as active markup.
 */
import {
  type FileKind,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TEXT_FILE_BYTES,
  MAX_EXCERPT_CHARS,
} from "./chat-attachment-schema.ts";
import { readImageInfo } from "./chat-files-image.ts";
import { filesFail, filesOk, type ChatFilesResult } from "./chat-files-model.ts";
import { decodeTextFile } from "./chat-files-text.ts";

type Media = { readonly kind: FileKind; readonly mediaType: string };

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

const IMAGE_TYPES: Readonly<
  Record<string, { readonly format: string; readonly mediaType: string }>
> = {
  jpg: { format: "jpeg", mediaType: "image/jpeg" },
  jpeg: { format: "jpeg", mediaType: "image/jpeg" },
  png: { format: "png", mediaType: "image/png" },
  webp: { format: "webp", mediaType: "image/webp" },
};

/** Resolves the allowlisted kind and media type from the exact filename extension. */
export const resolveMedia = (name: string): Media | null => {
  const dot = name.lastIndexOf(".");
  if (dot <= 0 || dot === name.length - 1) return null;
  const extension = name.slice(dot + 1).toLowerCase();
  const image = IMAGE_TYPES[extension];
  if (image !== undefined) return { kind: "image", mediaType: image.mediaType };
  const text = TEXT_TYPES[extension];
  return text === undefined ? null : { kind: "text", mediaType: text };
};

const formatOf = (mediaType: string): string | null =>
  Object.values(IMAGE_TYPES).find((entry) => entry.mediaType === mediaType)?.format ?? null;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const RIFF = [0x52, 0x49, 0x46, 0x46] as const;
const WEBP = [0x57, 0x45, 0x42, 0x50] as const;

const hasBytes = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean => {
  if (offset + expected.length > bytes.byteLength) return false;
  for (let index = 0; index < expected.length; index += 1) {
    if (bytes[offset + index] !== expected[index]) return false;
  }
  return true;
};

/**
 * Full binary image signatures only: a text file starting with plain ASCII
 * letters such as "RISK" must not be misread as an image. Any other binary
 * content is still rejected by fatal UTF-8 decoding and the control policy.
 */
const hasImageSignature = (bytes: Uint8Array): boolean =>
  (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
  hasBytes(bytes, 0, PNG_SIGNATURE) ||
  (hasBytes(bytes, 0, RIFF) && hasBytes(bytes, 8, WEBP));

export type ValidatedFile = {
  readonly kind: FileKind;
  readonly mediaType: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly excerpt: string | null;
  readonly chars: number;
  readonly digest: string;
};

export const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Validates actual bytes against the resolved filename type and returns safe metadata. */
export const validateFileBytes = async (
  name: string,
  bytes: Uint8Array,
): Promise<ChatFilesResult<ValidatedFile>> => {
  if (bytes.byteLength === 0) return filesFail("invalid_content");
  const media = resolveMedia(name);
  if (media === null) return filesFail("unsupported_type");
  const digest = await sha256Hex(bytes);
  if (media.kind === "image") {
    if (bytes.byteLength > MAX_IMAGE_BYTES) return filesFail("file_too_large");
    const info = readImageInfo(bytes);
    if (!info.ok) return filesFail("invalid_content");
    if (info.width <= 0 || info.height <= 0) return filesFail("invalid_content");
    if (info.width * info.height > MAX_IMAGE_PIXELS) return filesFail("file_too_large");
    if (info.animated) return filesFail("unsupported_type");
    if (info.format !== formatOf(media.mediaType)) return filesFail("unsupported_type");
    return filesOk({
      kind: "image",
      mediaType: media.mediaType,
      width: info.width,
      height: info.height,
      excerpt: null,
      chars: 0,
      digest,
    });
  }
  if (bytes.byteLength > MAX_TEXT_FILE_BYTES) return filesFail("file_too_large");
  if (hasImageSignature(bytes)) return filesFail("unsupported_type");
  const decoded = decodeTextFile(bytes, MAX_EXCERPT_CHARS);
  if (!decoded.ok) return filesFail("invalid_content");
  return filesOk({
    kind: "text",
    mediaType: media.mediaType,
    width: null,
    height: null,
    excerpt: decoded.excerpt,
    chars: decoded.chars,
    digest,
  });
};
