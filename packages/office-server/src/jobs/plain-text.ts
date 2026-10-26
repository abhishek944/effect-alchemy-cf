import { Buffer } from "node:buffer";
import { RichTextBuilder, RichTextValue } from "@univerjs/core";
import {
  transformDocumentDataToSnapshot,
  transformSnapshotToDocumentData,
  type ISnapshotServerService,
} from "@univerjs-pro/collaboration";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import { OfficeInvalid, safeFailure } from "@starter/office-contract";

const invalid = () => new OfficeInvalid(safeFailure("INVALID_INPUT"));
const unavailable = async (): Promise<never> => {
  throw invalid();
};
/** The SDK converter writes only its returned snapshot here; publication belongs to the job host. */
const snapshotCollector: ISnapshotServerService = {
  saveSnapshot: async () => ({ error: undefined }),
  getUnitOnRev: unavailable,
  getSheetBlock: unavailable,
  getDeserializedSheetBlock: unavailable,
  fetchMissingChangesets: unavailable,
  getResourcesRequest: unavailable,
  updateSnapshot: unavailable,
  saveSheetBlock: unavailable,
  saveChangeset: unavailable,
  copyFileMeta: unavailable,
  getLatestCsReqIdBySid: unavailable,
};

/** TXT is UTF-8 (optional BOM). Normalize line endings, never interpret text as native structure. */
export async function importPlainText(bytes: Uint8Array, unitId: string, title: string) {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalid();
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) throw invalid();
  }
  const data = RichTextBuilder.create().text(text.replace(/\r\n?/g, "\n")).getData();
  data.id = unitId;
  data.title = title;
  // A standalone document needs its final section, unlike rich text embedded inside a cell.
  if (data.body)
    data.body.sectionBreaks = [
      { startIndex: data.body.dataStream.length - 1, sectionId: `${unitId}_section` },
    ];
  const { snapshot } = await transformDocumentDataToSnapshot(
    { metadata: {} },
    data,
    unitId,
    1, // Initial native publication and imported-seed admission both require revision 1.
    snapshotCollector,
  );
  return { snapshot, sheetBlocks: [] };
}

/** SDK main-body plain text: formatting, images, headers/footers and notes are not exported. */
export function exportPlainText(native: ISnapshotWithBlocks): Buffer {
  const data = transformSnapshotToDocumentData(native.snapshot);
  if (!data.body) throw invalid();
  return Buffer.from(RichTextValue.create(data).toPlainText(), "utf8");
}
