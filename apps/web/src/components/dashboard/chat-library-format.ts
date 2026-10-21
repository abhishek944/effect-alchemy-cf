import { formatFileSize } from "@/lib/chat-file-local";
import type { SavedFile } from "@/lib/chat-library-types";

export const savedOrigin = (file: SavedFile): string =>
  file.origin === "generated" ? "Generated" : "Uploaded";

export function savedTime(file: SavedFile): string {
  const date = new Date(file.createdAt);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const day =
    date.toDateString() === today.toDateString()
      ? "Today"
      : date.toDateString() === yesterday.toDateString()
        ? "Yesterday"
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${day}, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`;
}

export const savedIdentityLabel = (file: SavedFile): string =>
  `${file.name} · ${savedOrigin(file)} · ${savedTime(file)} · File ${file.id}`;

export function savedMeta(file: SavedFile): string {
  const type = file.mediaType.startsWith("image/")
    ? file.mediaType.slice(6).toUpperCase()
    : file.mediaType;
  const dimensions = file.width && file.height ? ` · ${file.width} × ${file.height}` : "";
  return `${type}${dimensions} · ${formatFileSize(file.byteSize)}`;
}
