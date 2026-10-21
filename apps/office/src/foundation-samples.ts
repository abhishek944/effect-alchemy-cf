import { createOfficeHeadless, OFFICE_NATIVE_TYPES } from "@starter/office-server/jobs";

export async function createSheetSample() {
  const native = await createOfficeHeadless({
    unitId: "foundation-sheet",
    unitType: OFFICE_NATIVE_TYPES.sheet,
  });
  try {
    const workbook = native.api.createWorkbook({
      id: "foundation-sheet",
      name: "Native SDK foundation",
    });
    const sheet = workbook.getActiveSheet();
    sheet.getRange("A1:B3").setValues([
      ["Native Sheet", "Value"],
      ["Verified", 42],
      ["Linux", "amd64"],
    ]);
    if (sheet.getRange("B2").getValue() !== 42)
      throw new Error("Native Sheet value verification failed.");
    return { unitType: "sheet" as const, unitData: workbook.save() };
  } finally {
    native.close();
  }
}

export async function createDocSample() {
  const native = await createOfficeHeadless({
    unitId: "foundation-doc",
    unitType: OFFICE_NATIVE_TYPES.doc,
  });
  try {
    const document = native.api.createDocument({
      id: "foundation-doc",
      title: "Native Doc foundation",
    });
    if (!document.insertText(0, "Native Doc: Linux amd64 SDK 1.0.3 foundation.\n")) {
      throw new Error("Native Doc insertion failed.");
    }
    const data = document.save();
    if (!data.body?.dataStream.includes("Native Doc"))
      throw new Error("Native Doc value verification failed.");
    return { unitType: "doc" as const, unitData: data };
  } finally {
    native.close();
  }
}

export async function createSlideSample() {
  const native = await createOfficeHeadless({
    unitId: "foundation-slide",
    unitType: OFFICE_NATIVE_TYPES.slide,
  });
  try {
    const presentation = native.api.createPresentation({
      id: "foundation-slide",
      name: "Native Slide foundation",
    });
    const slide = presentation.getActiveSlide() ?? presentation.appendSlide({ name: "Foundation" });
    const shape = slide.insertShape({
      // oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- SDK augmentation resolves in strict package tsc.
      shapeType: native.api.Enum.ShapeTypeEnum.RoundRect,
      transform: { left: 80, top: 100, width: 560, height: 180 },
      visible: true,
      selectable: true,
      // oxlint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-member-access -- SDK augmentation resolves in strict package tsc.
      shapeData: { fill: { fillType: native.api.Enum.ShapeFillEnum.SolidFill, color: "#dbeafe" } },
    });
    if (shape === null) throw new Error("Native Slide shape insertion failed.");
    shape.getText().setText("Native Slide: Linux amd64 SDK 1.0.3");
    if (slide.getShapes().length === 0) throw new Error("Native Slide shape verification failed.");
    return { unitType: "slide" as const, unitData: presentation.save() };
  } finally {
    native.close();
  }
}
