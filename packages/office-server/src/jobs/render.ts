import { OfficeInvalid, safeFailure } from "@starter/office-contract";
import type { UniverCollaborationRuntime } from "@univer-cli/univer-collaboration-runtime";
import type { IsolatedJob } from "../ports/jobs.ts";
import { createOfficeRenderer } from "./renderer.ts";

export type RenderOptions = Parameters<typeof createOfficeRenderer>[0];
/** Uses only the clean immutable input runtime; never an execution job's mutated instance. */
export async function renderNative(
  runtime: UniverCollaborationRuntime,
  job: Extract<IsolatedJob, { kind: "render" }>,
  options: RenderOptions,
) {
  const data = await runtime.exportUnitData();
  if (data.id !== job.binding.unitId) throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  const renderer = await createOfficeRenderer(options);
  const selection = job.selection;
  try {
    if (selection.kind === "sheet" && job.binding.kind === "sheet" && "sheetOrder" in data) {
      const sheet = data.sheets[selection.worksheetId];
      if (
        !sheet ||
        typeof sheet.name !== "string" ||
        Object.values(data.sheets).filter((value) => value.name === sheet.name).length !== 1
      )
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      return await renderer.screenshots.capture({
        unitType: "sheet",
        unitData: data,
        target: { kind: "sheet-range", range: selection.range, sheetName: sheet.name, scale: 1 },
      });
    }
    if (selection.kind === "doc" && job.binding.kind === "doc" && "body" in data)
      return await renderer.screenshots.capture({
        unitType: "doc",
        unitData: data,
        target: { kind: "doc-pages", pages: selection.pages, scale: 1 },
      });
    if (
      selection.kind === "slide" &&
      job.binding.kind === "slide" &&
      "slideOrder" in data &&
      !("pageOrder" in data)
    ) {
      if (selection.pages.some((id) => !data.slideOrder.includes(id)))
        throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      return await renderer.screenshots.capture({
        unitType: "slide",
        unitData: data,
        target: { kind: "slide-pages", pages: selection.pages, scale: 1 },
      });
    }
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  } finally {
    await renderer.close();
  }
}
