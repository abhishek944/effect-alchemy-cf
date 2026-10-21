import "../frame/native.css";
import {
  DocumentFlavor,
  LocaleType,
  LifecycleService,
  LifecycleStages,
  getDocsEmptySnapshot,
} from "@univerjs/core";
import { createNativeApplication } from "../frame/native.ts";
import { PageTypeEnum, type ISlideData } from "@univerjs-pro/slides";
import type { IShapeCreateInput } from "@univerjs-pro/engine-shape";
import { Schema } from "effect";
import { nativePublicDiagnostic } from "./diagnostics.ts";
import { confirmNativeRendering } from "../frame/rendering.ts";

const query = new URLSearchParams(location.search);
const kind =
  query.get("kind") === "doc" ? "doc" : query.get("kind") === "slide" ? "slide" : "sheet";
const theme = query.get("theme") === "light" ? "light" : "dark";
const root = document.getElementById("office-native");
if (root === null) throw new Error("Native artifact container missing.");
document.documentElement.dataset.officeArtifact = "loading";
let failed = false;
let cleanup = () => {};
window.addEventListener("unhandledrejection", () => {
  failed = true;
  document.documentElement.dataset.officeArtifact = "error";
});
window.addEventListener("error", (event) => {
  failed = true;
  document.documentElement.dataset.officeArtifact = "error";
  const diagnostic = nativePublicDiagnostic(event.message);
  console.error("Public SDK diagnostic", diagnostic);
  document.documentElement.dataset.officeDiagnostic = diagnostic.join(", ");
});
try {
  // Do not load collaboration facade augmentation into this offline-only SDK artifact runtime.
  if (kind === "slide") await import("@univerjs-pro/slides/facade");
  const native = createNativeApplication(root, kind, theme, {
    id: "synthetic-office-user",
    name: "SDK artifact",
  });
  cleanup = () => native.univer.dispose();
  window.addEventListener("pagehide", cleanup, { once: true });
  if (kind === "sheet") {
    const workbook = native.univerAPI.createWorkbook({
      id: "office-artifact-sheet",
      name: "Quarterly budget",
      locale: LocaleType.EN_US,
      sheetOrder: ["budget", "assumptions"],
      sheets: {
        budget: {
          id: "budget",
          name: "Budget",
          rowCount: 50,
          columnCount: 10,
          cellData: {
            0: {
              0: { v: "Category" },
              1: { v: "Q1 actual" },
              2: { v: "Q2 plan" },
              3: { v: "Change" },
              4: { v: "Notes" },
            },
            1: { 0: { v: "Product" }, 1: { v: 48000 }, 2: { v: 52000 } },
            2: { 0: { v: "Travel" }, 1: { v: 12000 }, 2: { v: 9600 }, 3: { v: "−20%" } },
            3: { 0: { v: "Tools" }, 1: { v: 8000 }, 2: { v: 8000 } },
            4: { 0: { v: "Total" }, 1: { v: 68000 }, 2: { f: "=SUM(C2:C4)", v: 69600 } },
          },
          defaultColumnWidth: 120,
        },
        assumptions: { id: "assumptions", name: "Assumptions", rowCount: 20, columnCount: 5 },
      },
    });
    workbook.getActiveSheet().getRange("C3").activate();
    if (workbook.getActiveSheet().getRange("C3").getValue() !== 9600)
      throw new Error("Native value readback failed.");
  } else if (kind === "doc") {
    const base = getDocsEmptySnapshot(
      "office-artifact-doc",
      LocaleType.EN_US,
      "Launch brief",
      DocumentFlavor.TRADITIONAL,
    );
    const section = base.body?.sectionBreaks?.[0];
    if (section === undefined) throw new Error("Native document section missing.");
    const dataStream = "Launch brief\rPrepare the quarterly plan.\r\n";
    const doc = native.univerAPI.createDocument({
      ...base,
      body: {
        ...base.body,
        dataStream,
        paragraphs: [
          { startIndex: dataStream.indexOf("\r"), paragraphId: "launch-title" },
          { startIndex: dataStream.lastIndexOf("\r"), paragraphId: "launch-body" },
        ],
        sectionBreaks: [{ ...section, startIndex: dataStream.length - 1 }],
      },
    });
    if (doc.getId() !== "office-artifact-doc") throw new Error("Native document identity failed.");
  } else {
    const data: Partial<ISlideData> = {
      id: "office-artifact-slide",
      name: "Strategy deck",
      defaultPageSize: { width: 960, height: 540 },
      slideOrder: ["opening"],
      slides: {
        opening: {
          id: "opening",
          name: "Quarterly strategy",
          pageType: PageTypeEnum.Slide,
          elements: {},
          elementOrder: [],
        },
      },
    };
    const presentation = native.univerAPI.createPresentation(data);
    if (presentation.getSlides().length !== 1)
      throw new Error("Native presentation readback failed.");
    await native.injector.get(LifecycleService).onStage(LifecycleStages.Steady);
    // SDK root enum declarations are broken; validate the real exported member, never cast it.
    const rectangle = Schema.declare(
      (value: unknown): value is Extract<IShapeCreateInput["shapeType"], "rect"> =>
        value === "rect",
    );
    const exportedShapes: unknown = native.univerAPI.Enum.ShapeTypeEnum;
    const { Rect } = Schema.decodeUnknownSync(Schema.Struct({ Rect: rectangle }))(exportedShapes);
    const heading = presentation.getSlideByIndex(0)?.insertShape({
      shapeType: Rect,
      transform: { left: 80, top: 100, width: 760, height: 160 },
    });
    if (!heading) throw new Error("Native slide title missing.");
    heading.getText().setText("Quarterly strategy").setFontSize(36);
  }
  await native.injector.get(LifecycleService).onStage(LifecycleStages.Steady);
  await confirmNativeRendering(native.injector, kind, `office-artifact-${kind}`);
  await native.activity.wait();
  document.documentElement.dataset.officeActivity = native.activity.idle() ? "idle" : "pending";
  if (failed) throw new Error("Native SDK reported a runtime failure.");
  document.documentElement.dataset.officeArtifact = "ready";
  document.documentElement.dataset.officeKind = kind;
} catch (error) {
  try {
    cleanup();
  } catch {
    /* Artifact cleanup never establishes success. */
  }
  console.error("Synthetic native SDK artifact failed", error);
  document.documentElement.dataset.officeArtifact = "error";
  const notice = document.createElement("p");
  notice.setAttribute("role", "alert");
  notice.textContent =
    "Native SDK artifact could not initialize. No backend or save success is claimed.";
  root.replaceChildren(notice);
}
