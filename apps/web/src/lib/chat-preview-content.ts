import type { LocalFile } from "./chat-file-local";
import type { SavedFile } from "./chat-library-types";
import { savedOriginalUrl } from "./chat-library-api";
import { decodeTextFile } from "./chat-file-policy";

export type AttachmentSource = LocalFile | SavedFile;
export type PreviewSection = { title: string; text?: string; rows?: string[][] };
export type AttachmentContent = {
  sections: PreviewSection[];
  note: string | null;
  originalText?: string;
};
export const isLocalAttachment = (source: AttachmentSource): source is LocalFile =>
  "file" in source;

/** RFC-style quoted fields, including escaped quotes and embedded newlines. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const cell = () => {
    if (row.length < 20) row.push(field.slice(0, 500));
    field = "";
  };
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (quoted || field.length === 0) quoted = !quoted;
      else field += character;
    } else if (!quoted && (character === "," || character === "\n" || character === "\r")) {
      cell();
      if (character !== ",") {
        rows.push(row);
        row = [];
        if (rows.length >= 100) return rows;
        if (character === "\r" && text[index + 1] === "\n") index++;
      }
    } else field += character;
  }
  if (field.length || row.length) {
    cell();
    rows.push(row);
  }
  return rows;
}

async function originalBytes(source: AttachmentSource, signal: AbortSignal): Promise<Uint8Array> {
  if (source.byteSize > 1024 * 1024)
    throw new Error("This file exceeds the content preview limit.");
  if (isLocalAttachment(source)) return new Uint8Array(await source.file.arrayBuffer());
  const response = await fetch(savedOriginalUrl(source), {
    credentials: "same-origin",
    cache: "no-store",
    redirect: "error",
    signal,
  });
  if (!response.ok || !response.body) throw new Error("The saved original could not be read.");
  const expected = source.kind === "text" ? "text/plain" : source.mediaType;
  if (response.headers.get("content-type")?.split(";")[0]?.trim() !== expected) {
    await response.body.cancel();
    throw new Error("The saved original has an unexpected format.");
  }
  const reader = response.body.getReader();
  const bytes = new Uint8Array(source.byteSize);
  let offset = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (offset + chunk.value.length > bytes.length)
        throw new Error("The original has unexpected content.");
      bytes.set(chunk.value, offset);
      offset += chunk.value.length;
    }
    if (offset !== bytes.length) throw new Error("The saved original was incomplete.");
    return bytes;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Reads content only; never imports Office, evaluates formulas or renders markup. */
export async function readAttachmentContent(
  source: AttachmentSource,
  signal: AbortSignal,
): Promise<AttachmentContent> {
  signal.throwIfAborted();
  // Office content is native state, not a browser parsing format. No private bytes are read.
  if (source.kind === "office")
    return {
      sections: [],
      note: `${source.name} · ${source.mediaType} · ${source.byteSize} bytes. Download the original, or open it in the panel to create a native draft.`,
    };
  const bytes = await originalBytes(source, signal);
  signal.throwIfAborted();
  const decoded = decodeTextFile(bytes, 20_000);
  if (!decoded.ok) throw new Error("This file could not be read as safe UTF-8 text.");
  const csv = source.name.toLowerCase().endsWith(".csv");
  return {
    originalText: decoded.text,
    sections: [
      {
        title: source.name,
        ...(csv ? { rows: csvRows(decoded.text) } : { text: decoded.excerpt }),
      },
    ],
    note: csv
      ? "CSV content preview: up to 100 rows, 20 columns and 500 characters per cell. Download for the complete file."
      : decoded.text.length > decoded.excerpt.length
        ? "Showing the first 20,000 characters. Download for the complete file."
        : null,
  };
}
