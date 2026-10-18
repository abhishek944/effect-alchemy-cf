/**
 * Aggregate admission for staged files, before bytes are retained or decoded.
 *
 * A selection is accepted in order while it fits the 5-file and 20 MiB message
 * caps and the 40 MiB tab-wide unsent budget; anything past a limit is rejected
 * with an explicit reason and the existing draft is preserved. Nothing is
 * evicted or truncated.
 */
import {
  LOCAL_DRAFT_BYTES_PER_TAB,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_MESSAGE_ATTACHMENT_BYTES,
} from "@/lib/chat-capability-file-types";
import { formatFileSize, type LocalFile } from "@/lib/chat-file-local";

export type Admission = { accepted: File[]; rejection: string | null };

export function admitFiles(input: {
  incoming: readonly File[];
  chatRows: readonly LocalFile[];
  tabRows: readonly LocalFile[];
}): Admission {
  let count = input.chatRows.length;
  let messageBytes = input.chatRows.reduce((sum, row) => sum + row.byteSize, 0);
  let tabBytes = input.tabRows.reduce((sum, row) => sum + row.byteSize, 0);
  const accepted: File[] = [];
  let rejection: string | null = null;
  for (const file of input.incoming) {
    const reject = (reason: string) => {
      rejection ??= reason;
    };
    if (count >= MAX_ATTACHMENTS_PER_MESSAGE)
      reject(`At most ${MAX_ATTACHMENTS_PER_MESSAGE} files can be added to one message.`);
    else if (messageBytes + file.size > MAX_MESSAGE_ATTACHMENT_BYTES)
      reject(
        `Files for one message can total at most ${formatFileSize(MAX_MESSAGE_ATTACHMENT_BYTES)}.`,
      );
    else if (tabBytes + file.size > LOCAL_DRAFT_BYTES_PER_TAB)
      reject(
        `Unsent files in this tab can total at most ${formatFileSize(LOCAL_DRAFT_BYTES_PER_TAB)}.`,
      );
    else {
      accepted.push(file);
      count += 1;
      messageBytes += file.size;
      tabBytes += file.size;
    }
  }
  return { accepted, rejection };
}
