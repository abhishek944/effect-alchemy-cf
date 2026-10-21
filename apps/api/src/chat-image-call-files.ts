import { Schema } from "effect";
import { SavedFile } from "./chat-library-schema.ts";
import {
  AssistantSavedFilesPage,
  type ImageCallFile,
  type ImageCallView,
} from "./chat-image-call-schema.ts";
import type { CallSql } from "./chat-image-call-table.ts";
import {
  CallDigest,
  CallIndex,
  CALL_SUMMARY_BYTES,
  callJson,
  callParse,
  callValue,
  freezeCall,
  ImageCallError,
} from "./chat-image-call-values.ts";

const FILE_BYTES = 16_384;
type FileRow = {
  call_key: string;
  output_index: number;
  file_id: string;
  assistant_entry_id: number;
  model_index: number;
  call_position: number;
  file_json: string;
};
const identity = (file: SavedFile): string => {
  const { state: _state, ...immutable } = file;
  return callJson(immutable, FILE_BYTES);
};
function generatedFile(file: SavedFile, call: ImageCallView): void {
  if (
    file.origin !== "generated" ||
    file.kind !== "image" ||
    !["ready", "unavailable"].includes(file.state) ||
    file.expiresAt !== null ||
    file.width === null ||
    file.height === null ||
    file.excerpt !== null ||
    file.generation?.callId !== call.admission.key ||
    file.generation.operationId !== call.admission.operationId
  )
    throw new ImageCallError("conflict");
}
export function saveCallFiles(
  sql: CallSql,
  call: ImageCallView,
  files: readonly ImageCallFile[],
): void {
  for (const { index, file } of files) {
    generatedFile(file, call);
    const known = sql
      .exec<FileRow>(
        `SELECT * FROM chat_image_call_files
      WHERE call_key = ? AND output_index = ?`,
        call.admission.key,
        index,
      )
      .toArray()[0];
    if (known !== undefined) {
      const old = decodeFileRow(known, call);
      if (identity(old) !== identity(file)) throw new ImageCallError("conflict");
      continue;
    }
    if (
      sql
        .exec(`SELECT file_id FROM chat_image_call_files WHERE file_id = ? LIMIT 1`, file.id)
        .toArray().length
    )
      throw new ImageCallError("conflict");
    const a = call.admission;
    sql.exec(
      `INSERT INTO chat_image_call_files VALUES (?, ?, ?, ?, ?, ?, ?)`,
      a.key,
      index,
      file.id,
      a.assistantEntryId,
      a.modelIndex,
      a.callPosition,
      callJson(file, FILE_BYTES),
    );
  }
}
function decodeFileRow(row: FileRow, call: ImageCallView): SavedFile {
  const file = callValue(SavedFile, callParse(row.file_json, FILE_BYTES), "corrupt");
  callValue(CallIndex, row.output_index, "corrupt");
  if (
    row.call_key !== call.admission.key ||
    row.file_id !== file.id ||
    row.assistant_entry_id !== call.admission.assistantEntryId ||
    row.model_index !== call.admission.modelIndex ||
    row.call_position !== call.admission.callPosition
  )
    throw new ImageCallError("corrupt");
  try {
    generatedFile(file, call);
  } catch {
    throw new ImageCallError("corrupt");
  }
  return file;
}
const MessageId = Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,15}:(0|[1-9][0-9]{0,15})$/));
const Cursor = Schema.Struct({
  version: Schema.Literal(1),
  messageId: MessageId,
  callPosition: CallIndex,
  index: CallIndex,
});
function decodeCursor(messageId: string, cursor: string): typeof Cursor.Type {
  if (cursor.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(cursor))
    throw new ImageCallError("invalid_input");
  try {
    const value = callValue(
      Cursor,
      JSON.parse(atob(cursor.replaceAll("-", "+").replaceAll("_", "/"))),
    );
    if (value.messageId !== messageId) throw new ImageCallError("invalid_input");
    return value;
  } catch {
    throw new ImageCallError("invalid_input");
  }
}
export function assistantCallFiles(
  sql: CallSql,
  read: (key: string) => ImageCallView | null,
  messageId: string,
  cursor?: string,
): AssistantSavedFilesPage {
  callValue(MessageId, messageId);
  const [entry, model] = messageId.split(":").map(Number);
  callValue(CallIndex, entry);
  callValue(CallIndex, model);
  if (entry === undefined || model === undefined || entry === 0)
    throw new ImageCallError("invalid_input");
  const after = cursor === undefined ? null : decodeCursor(messageId, cursor);
  const position = after?.callPosition ?? -1;
  const rows = sql
    .exec<FileRow>(
      `SELECT * FROM chat_image_call_files
    WHERE assistant_entry_id = ? AND model_index = ?
    AND (call_position > ? OR (call_position = ? AND output_index > ?))
    ORDER BY call_position, output_index LIMIT 31`,
      entry,
      model,
      position,
      position,
      after?.index ?? -1,
    )
    .toArray();
  const files: SavedFile[] = [];
  let last: FileRow | undefined;
  for (const row of rows.slice(0, 30)) {
    callValue(CallDigest, row.call_key, "corrupt");
    const call = read(row.call_key);
    if (call === null) throw new ImageCallError("corrupt");
    const file = decodeFileRow(row, call);
    if (row.assistant_entry_id !== entry || row.model_index !== model)
      throw new ImageCallError("corrupt");
    try {
      callJson(
        { messageId, files: [...files, file], nextCursor: "x".repeat(2048) },
        CALL_SUMMARY_BYTES,
      );
    } catch {
      break;
    }
    files.push(file);
    last = row;
  }
  const more = rows.length > files.length;
  if (more && last === undefined) throw new ImageCallError("corrupt");
  const nextCursor =
    more && last !== undefined
      ? btoa(
          JSON.stringify({
            version: 1,
            messageId,
            callPosition: last.call_position,
            index: last.output_index,
          }),
        )
          .replaceAll("+", "-")
          .replaceAll("/", "_")
          .replaceAll("=", "")
      : null;
  return freezeCall(
    callValue(AssistantSavedFilesPage, { messageId, files, nextCursor }, "corrupt"),
  );
}
