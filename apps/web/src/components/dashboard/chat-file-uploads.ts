import { capabilityMessage, uploadChatFile } from "@/lib/chat-capability-api";
import { UNSUPPORTED_REASON, type LocalFile } from "@/lib/chat-file-local";
import type { UploadOutcome } from "@/lib/chat-store-context";

/**
 * Uploads every not-yet-uploaded row sequentially and returns the frozen ids.
 * A transient upload failure is stored as `upload_failed` so the same file ID
 * and bytes can be retried; invalid or preparing rows still fail closed.
 */
export async function uploadStagedFiles(
  chatId: string,
  rows: readonly LocalFile[],
  onUpdate: (id: string, next: (row: LocalFile) => LocalFile) => void,
): Promise<UploadOutcome> {
  const ids: string[] = [];
  for (const row of rows) {
    ids.push(row.id);
    if (row.descriptor) continue;
    if (row.state === "unsupported" || row.state === "failed")
      return { ok: false, error: row.error ?? UNSUPPORTED_REASON };
    if (row.state === "preparing")
      return { ok: false, error: `"${row.name}" is still being prepared.` };
    onUpdate(row.id, (current) => ({ ...current, state: "uploading", error: null }));
    try {
      const descriptor = await uploadChatFile(chatId, row.id, row.file, row.name, row.mediaType);
      onUpdate(row.id, (current) => ({ ...current, state: "ready", descriptor, error: null }));
    } catch (cause) {
      const error = capabilityMessage(cause, `Uploading "${row.name}"`);
      onUpdate(row.id, (current) => ({ ...current, state: "upload_failed", error }));
      return { ok: false, error };
    }
  }
  return { ok: true, ids };
}
