/**
 * Manual validators for file descriptors. A declared MIME type is not proof of
 * content: the file implementation must additionally verify magic bytes,
 * UTF-8 validity and decoded dimensions before acceptance.
 */
import type { ChatFileDescriptor, ChatFileDescriptorList } from "@/lib/chat-capability-file-types";
import { MAX_EXCERPT_CHARS } from "@/lib/chat-capability-file-types";
import {
  isBoundedText,
  isIsoTimestamp,
  isPositiveCount,
  listed,
} from "@/lib/chat-capability-validate";
import { isRecord, isUuid } from "@/lib/chat-validate-base";
import { isOfficeMediaType, OFFICE_MEDIA_PATTERN } from "@/lib/chat-file-office";

const mediaTypePattern = new RegExp(
  `^(image\\/(jpeg|png|webp)|${OFFICE_MEDIA_PATTERN}|application\\/json|text\\/[a-z0-9][a-z0-9.+-]{0,63})$`,
);
const fileStates: readonly ChatFileDescriptor["state"][] = [
  "uploading",
  "ready",
  "failed",
  "expired",
  "unavailable",
];

const unique = (values: readonly string[]): boolean => new Set(values).size === values.length;

/** Unique validated attachment references preserve original identity. */
export function parseAttachmentIds(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const ids: string[] = [];
  for (const id of value) {
    if (!isUuid(id)) return null;
    ids.push(id);
  }
  return unique(ids) ? ids : null;
}

export function parseChatFileDescriptor(value: unknown): ChatFileDescriptor | null {
  if (!isRecord(value) || !isUuid(value.id) || !isUuid(value.chatId)) return null;
  if (value.kind !== "image" && value.kind !== "text" && value.kind !== "office") return null;
  if (!listed(fileStates, value.state)) return null;
  if (!isBoundedText(value.name, 255) || value.name.length < 1) return null;
  if (value.name.trim() !== value.name || value.name.includes("/") || value.name.includes("\\"))
    return null;
  for (const character of value.name) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return null;
  }
  if (!isBoundedText(value.mediaType, 128) || !mediaTypePattern.test(value.mediaType)) return null;
  if ((value.kind === "image") !== value.mediaType.startsWith("image/")) return null;
  if ((value.kind === "office") !== isOfficeMediaType(value.mediaType)) return null;
  if (!isPositiveCount(value.byteSize)) return null;
  if (value.width !== null && !isPositiveCount(value.width)) return null;
  if (value.height !== null && !isPositiveCount(value.height)) return null;
  if (value.excerpt !== null && !isBoundedText(value.excerpt, MAX_EXCERPT_CHARS)) return null;
  if (!isIsoTimestamp(value.createdAt)) return null;
  if (value.expiresAt !== null && !isIsoTimestamp(value.expiresAt)) return null;
  if (value.state === "ready") {
    const complete =
      value.kind === "image"
        ? value.width !== null && value.height !== null && value.excerpt === null
        : value.kind === "office"
          ? value.width === null && value.height === null && value.excerpt === null
          : value.excerpt !== null && value.width === null && value.height === null;
    if (!complete) return null;
  }
  return {
    id: value.id,
    chatId: value.chatId,
    kind: value.kind,
    name: value.name,
    mediaType: value.mediaType,
    byteSize: value.byteSize,
    state: value.state,
    width: value.width,
    height: value.height,
    excerpt: value.excerpt,
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
  };
}

export function parseChatFileDescriptorList(value: unknown): ChatFileDescriptorList | null {
  if (!isRecord(value) || !isUuid(value.chatId) || !Array.isArray(value.files)) return null;
  const files: ChatFileDescriptor[] = [];
  for (const item of value.files) {
    const file = parseChatFileDescriptor(item);
    if (!file || file.chatId !== value.chatId) return null;
    files.push(file);
  }
  return unique(files.map((file) => file.id)) ? { chatId: value.chatId, files } : null;
}
