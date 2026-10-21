import { UniverType } from "@univerjs/protocol";
import type { CreateUnitFromDataInput } from "@univerjs-pro/collaboration-service";
import type { Kind } from "@starter/office-contract";
import { createOfficeHeadless, OFFICE_NATIVE_TYPES } from "../jobs/runtime-factory.ts";

/** SDK Facade generates defaults. This is not a hand-built workbook/document repository. */
export async function createBlankNative(
  kind: Kind,
  unitId: string,
  title: string,
): Promise<CreateUnitFromDataInput> {
  const runtime = await createOfficeHeadless({ unitId, unitType: OFFICE_NATIVE_TYPES[kind] });
  try {
    switch (kind) {
      case "sheet": {
        const unit = runtime.api.createWorkbook({ id: unitId, name: title, rev: 1 });
        return { type: UniverType.UNIVER_SHEET, data: structuredClone(unit.save()) };
      }
      case "doc": {
        const unit = runtime.api.createDocument({ id: unitId, title, rev: 1 });
        return { type: UniverType.UNIVER_DOC, data: structuredClone(unit.save()) };
      }
      case "slide": {
        const unit = runtime.api.createPresentation({ id: unitId, name: title, rev: 1 });
        return { type: UniverType.UNIVER_SLIDE, data: structuredClone(unit.save()) };
      }
    }
    throw new RangeError("Unsupported native document kind");
  } finally {
    runtime.close();
  }
}
