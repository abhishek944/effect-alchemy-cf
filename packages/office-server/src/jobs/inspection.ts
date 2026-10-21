import { inspectContent, type ContentInspectionQuery } from "@univer-cli/content-inspection";
import type { UniverCollaborationRuntime } from "@univer-cli/univer-collaboration-runtime";
import type { InspectQuery } from "@starter/office-contract";
import type { JobBinding } from "../ports/jobs.ts";

function queryFor(query: InspectQuery): ContentInspectionQuery {
  switch (query.kind) {
    case "workbook":
      return query;
    case "worksheet":
      return { kind: "worksheet", worksheets: [{ id: query.worksheetId }] };
    case "range":
      return {
        kind: "worksheet-range",
        ranges: [{ range: query.range, worksheet: { id: query.worksheetId } }],
      };
    case "document":
      return query;
    case "paragraphs": {
      const [first, ...rest] = query.ids;
      if (first === undefined) throw new RangeError("A paragraph selector is required.");
      return { kind: "paragraph", paragraphs: [{ id: first }, ...rest.map((id) => ({ id }))] };
    }
    case "presentation":
      return query;
    case "slides": {
      const [first, ...rest] = query.ids;
      if (first === undefined) throw new RangeError("A slide selector is required.");
      return { kind: "slide", slides: [{ id: first }, ...rest.map((id) => ({ id }))] };
    }
  }
  throw new RangeError("Unsupported native inspection query.");
}
export function inspectNative(
  runtime: UniverCollaborationRuntime,
  binding: JobBinding,
  query: InspectQuery,
) {
  return inspectContent(
    {
      unitId: binding.unitId,
      unitType: binding.kind,
      execute: (input) => runtime.execute(input),
    },
    queryFor(query),
  );
}
