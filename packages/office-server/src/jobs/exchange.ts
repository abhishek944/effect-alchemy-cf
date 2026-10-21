import { Buffer } from "node:buffer";
import {
  CsvTypeInferenceMode,
  DocxCompatibilityMode,
  ExchangeFormat,
  FormulaCalculationMode,
  exportSnapshotToBuffer,
  importBufferToSnapshot,
} from "@univerjs-pro/exchange-node";
import { UniverInstanceType } from "@univerjs/core";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import type { IsolatedJob } from "../ports/jobs.ts";

export function importNative(job: Extract<IsolatedJob, { kind: "import" }>, bytes: Uint8Array) {
  const o = job.options;
  const common = { fileName: job.filename, unitId: job.binding.unitId };
  if (o.kind === "doc")
    return importBufferToSnapshot(Buffer.from(bytes), {
      ...common,
      type: UniverInstanceType.UNIVER_DOC,
      format: o.format === "doc" ? ExchangeFormat.DOC : ExchangeFormat.DOCX,
      compatibilityMode:
        o.compatibility === "modern"
          ? DocxCompatibilityMode.MODERN
          : DocxCompatibilityMode.TRADITIONAL,
    });
  if (o.kind === "slide")
    return importBufferToSnapshot(Buffer.from(bytes), {
      ...common,
      type: UniverInstanceType.UNIVER_SLIDE,
      format: o.format === "ppt" ? ExchangeFormat.PPT : ExchangeFormat.PPTX,
    });
  if (o.format === "csv" || o.format === "tsv")
    return importBufferToSnapshot(Buffer.from(bytes), {
      ...common,
      type: UniverInstanceType.UNIVER_SHEET,
      format: o.format === "csv" ? ExchangeFormat.CSV : ExchangeFormat.TSV,
      csv: {
        delimiter: o.delimiter,
        inferTypes: o.inferTypes === "off" ? CsvTypeInferenceMode.OFF : CsvTypeInferenceMode.SAFE,
      },
    });
  if (o.format === "xls")
    return importBufferToSnapshot(Buffer.from(bytes), {
      ...common,
      type: UniverInstanceType.UNIVER_SHEET,
      format: ExchangeFormat.XLS,
    });
  if (!("calculate" in o)) throw new RangeError("Invalid Sheet import options.");
  return importBufferToSnapshot(Buffer.from(bytes), {
    ...common,
    type: UniverInstanceType.UNIVER_SHEET,
    format: ExchangeFormat.XLSX,
    formulaCalculation:
      o.calculate === "no" ? FormulaCalculationMode.NO : FormulaCalculationMode.WHEN_EMPTY,
  });
}
export function exportNative(
  job: Extract<IsolatedJob, { kind: "export" }>,
  native: ISnapshotWithBlocks,
) {
  const o = job.options;
  if (o.kind === "doc")
    return exportSnapshotToBuffer(native, {
      type: UniverInstanceType.UNIVER_DOC,
      format: ExchangeFormat.DOCX,
    });
  if (o.kind === "slide")
    return exportSnapshotToBuffer(native, {
      type: UniverInstanceType.UNIVER_SLIDE,
      format: ExchangeFormat.PPTX,
    });
  if (o.format === "xlsx")
    return exportSnapshotToBuffer(native, {
      type: UniverInstanceType.UNIVER_SHEET,
      format: ExchangeFormat.XLSX,
      formulaCalculation: FormulaCalculationMode.NO,
    });
  return exportSnapshotToBuffer(native, {
    type: UniverInstanceType.UNIVER_SHEET,
    format: o.format === "csv" ? ExchangeFormat.CSV : ExchangeFormat.TSV,
    csv: { worksheetId: o.worksheetId },
  });
}
