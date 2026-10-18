import type { FileKind } from "@/lib/chat-capability-file-types";

export type PreviewFile = {
  id: string;
  name: string;
  kind: FileKind;
  mediaType: string;
  byteSize: number;
  width: number | null;
  height: number | null;
  /** Local object URL, or the private authenticated original path. */
  url: string | null;
  /** Reads the full safe text on demand; never executed as markup. */
  loadText: (() => Promise<string>) | null;
  /** True when a staged thumbnail already owns a budget lease for this file. */
  reserved: boolean;
  /** Actual staged-thumbnail lease key, so pending pins reuse the same charge. */
  reservationKey: string | null;
  readOnly: boolean;
};

export type PreviewLease = { key: string; decodedBytes: number; previewBytes: number };
