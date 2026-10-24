import type { ImportOptions } from "./requests.ts";

/** Shared original-open policy; CSV remains a saved text attachment, not prompt text. */
export function officeImportOptions(mediaType: string, filename: string): ImportOptions | null {
  if (mediaType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    return { kind: "sheet", format: "xlsx", calculate: "no" };
  if (mediaType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    return { kind: "doc", format: "docx", compatibility: "modern" };
  if (mediaType === "application/vnd.openxmlformats-officedocument.presentationml.presentation")
    return { kind: "slide", format: "pptx" };
  if (/\.csv$/i.test(filename) && ["text/csv", "application/csv", "text/plain"].includes(mediaType))
    return { kind: "sheet", format: "csv", delimiter: "auto", inferTypes: "safe" };
  return null;
}

export const officeAttachmentIds = (attachmentId: string) => ({
  operationId: `file_open_${attachmentId}`,
  uploadId: `file_upload_${attachmentId}`,
});
