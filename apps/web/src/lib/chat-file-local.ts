/**
 * Local staged-file preparation. Files stay in memory until an explicit Send;
 * this module only classifies, validates and reads display metadata, and never
 * uploads or stores anything. Classification follows the exact server filename
 * allowlist, never an operating-system MIME guess, and content is validated:
 * fatal UTF-8 with the control policy for text, real image structure for
 * JPEG/PNG/WebP, and bounded OOXML structure for Office. A thumbnail is created
 * only when the tab budget grants a reservation; Office stays staged without a
 * browser preview.
 */
import type { ChatFileDescriptor, FileKind } from "@/lib/chat-capability-file-types";
import {
  MAX_EXCERPT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  MAX_TEXT_FILE_BYTES,
  MAX_OFFICE_BYTES,
} from "@/lib/chat-capability-file-types";
import { isOfficeContainer } from "@/lib/chat-office-media";
import { readImageInfo } from "@/lib/chat-file-image-policy";
import {
  ALLOWED_EXTENSIONS,
  decodeTextFile,
  hasImageSignature,
  imageFormatFor,
  resolveMedia,
} from "@/lib/chat-file-policy";

export type LocalFileState =
  | "preparing"
  | "ready"
  | "uploading"
  | "upload_failed"
  | "unsupported"
  | "failed";

export type PreviewPolicy = {
  /** Reserves the tab budget before any object URL or decode is created. */
  allowPreview: (decodedBytes: number, previewBytes: number) => boolean;
};

export type LocalFile = {
  /** Attachment UUID; the same identity is uploaded and submitted on send. */
  id: string;
  file: File;
  name: string;
  mediaType: string;
  kind: FileKind;
  byteSize: number;
  state: LocalFileState;
  error: string | null;
  width: number | null;
  height: number | null;
  excerpt: string | null;
  previewUrl: string | null;
  /** True when the tab preview budget withheld this file's thumbnail. */
  previewLimited: boolean;
  /** Lease key charged while this row's thumbnail/preview work is alive. */
  reservationKey: string | null;
  descriptor: ChatFileDescriptor | null;
};

export const UNSUPPORTED_REASON =
  "Only JPEG, PNG, WebP, allowlisted text/code and XLSX/DOCX/PPTX files can be added.";

export const FILE_ACCEPT = ALLOWED_EXTENSIONS.map((extension) => `.${extension}`).join(",");

function baseRow(file: File, id: string, mediaType: string, kind: FileKind): LocalFile {
  return {
    id,
    file,
    name: file.name,
    mediaType,
    kind,
    byteSize: file.size,
    state: "preparing",
    error: null,
    width: null,
    height: null,
    excerpt: null,
    previewUrl: null,
    previewLimited: false,
    reservationKey: null,
    descriptor: null,
  };
}

function rejected(file: File, id: string, error: string): LocalFile {
  return {
    ...baseRow(file, id, "application/octet-stream", "text"),
    state: "unsupported",
    error,
  };
}

/** Real decode check for a previewed image; the structural parse already ran. */
async function decodeCheck(file: File, url: string): Promise<void> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    bitmap.close();
    return;
  }
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.addEventListener("load", () => resolve(), { once: true });
    image.addEventListener("error", () => reject(new Error("The image could not be decoded.")), {
      once: true,
    });
    image.src = url;
  });
}

/** Validates one selected file and reads the metadata its compact row shows. */
export async function prepareLocalFile(
  file: File,
  id: string,
  policy: PreviewPolicy,
): Promise<LocalFile> {
  const media = resolveMedia(file.name);
  if (media === null) return rejected(file, id, UNSUPPORTED_REASON);
  const base = baseRow(file, id, media.mediaType, media.kind);
  const limit =
    media.kind === "image"
      ? MAX_IMAGE_BYTES
      : media.kind === "office"
        ? MAX_OFFICE_BYTES
        : MAX_TEXT_FILE_BYTES;
  if (file.size <= 0 || file.size > limit) {
    return { ...base, state: "failed", error: fileSizeReason(media.kind, file.size, limit) };
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (media.kind === "office") {
    const extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
    if (!isOfficeContainer(bytes, extension))
      return {
        ...base,
        state: "unsupported",
        error: "The file content does not match a supported Office container.",
      };
    return { ...base, state: "ready" };
  }
  if (media.kind === "text") {
    if (hasImageSignature(bytes))
      return { ...base, state: "unsupported", error: "Image content cannot be added as text." };
    const decoded = decodeTextFile(bytes, MAX_EXCERPT_CHARS);
    if (!decoded.ok)
      return {
        ...base,
        state: "failed",
        error: "This file is not valid UTF-8 text with an allowed character set.",
      };
    return { ...base, state: "ready", excerpt: decoded.excerpt };
  }
  const info = readImageInfo(bytes);
  if (!info.ok) return { ...base, state: "failed", error: "This image could not be read." };
  if (info.animated)
    return { ...base, state: "unsupported", error: "Animated images are not supported." };
  if (info.format !== imageFormatFor(media.mediaType))
    return {
      ...base,
      state: "unsupported",
      error: "The file content does not match its extension.",
    };
  if (info.width * info.height > MAX_IMAGE_PIXELS) {
    return { ...base, state: "failed", error: "This image is larger than 16 megapixels." };
  }
  const decodedBytes = info.width * info.height * 4;
  const dimensions = { width: info.width, height: info.height };
  if (!policy.allowPreview(decodedBytes, bytes.byteLength)) {
    return { ...base, ...dimensions, state: "ready", previewLimited: true };
  }
  const url = URL.createObjectURL(file);
  try {
    await decodeCheck(file, url);
  } catch {
    URL.revokeObjectURL(url);
    return { ...base, ...dimensions, state: "failed", error: "This image could not be decoded." };
  }
  return { ...base, ...dimensions, state: "ready", previewUrl: url };
}

function fileSizeReason(kind: FileKind, size: number, limit: number): string {
  const label = kind === "image" ? "Images" : kind === "office" ? "Office files" : "Text files";
  return `${label} must be between 1 byte and ${formatFileSize(limit)}; this one is ${formatFileSize(size)}.`;
}

export function releaseLocalFile(file: LocalFile): void {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib < 10 ? kib.toFixed(1) : Math.round(kib)} KiB`;
  const mib = kib / 1024;
  return `${mib < 10 ? mib.toFixed(1) : Math.round(mib)} MiB`;
}
