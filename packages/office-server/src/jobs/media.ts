import type { ExportOptions } from "@starter/office-contract";

export function exportMediaType(options: ExportOptions): string {
  switch (options.format) {
    case "xlsx":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "txt":
      return "text/plain";
    case "csv":
      return "text/csv";
    case "tsv":
      return "text/tab-separated-values";
  }
  throw new RangeError("Unsupported native export format.");
}
