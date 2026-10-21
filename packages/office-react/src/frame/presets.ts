import { IImageIoService } from "@univerjs/core";
import { UniverDocsCorePreset, UniverFormulaEnginePlugin } from "@univerjs/preset-docs-core";
import { UniverDocsLayoutWorkerPlugin } from "@univerjs/docs";
import { UniverDocsDrawingPreset } from "@univerjs/preset-docs-drawing";
import { UniverDocsHyperLinkPreset } from "@univerjs/preset-docs-hyper-link";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { UniverDrawingPlugin } from "@univerjs/drawing";
import { UniverDrawingUIPlugin } from "@univerjs/drawing-ui";
import { UniverSlidesPlugin } from "@univerjs-pro/slides";
import { UniverSlidesUIPlugin } from "@univerjs-pro/slides-ui";
import { UniverShapePlugin } from "@univerjs-pro/engine-shape";
import { UniverProFormulaEnginePlugin } from "@univerjs-pro/engine-formula";
import { UniverShapeEditorPlugin } from "@univerjs-pro/shape-editor";
import { UniverShapeEditorUIPlugin } from "@univerjs-pro/shape-editor-ui";
import type { IPreset } from "@univerjs/presets";
import type { Kind } from "@starter/office-contract";

export function nativePresets(container: HTMLElement, kind: Kind, remote: boolean): IPreset[] {
  if (kind === "sheet")
    return [
      UniverSheetsCorePreset({
        container,
        header: true,
        toolbar: true,
        ribbonType: "classic",
        formulaBar: true,
        footer: { sheetBar: true, statisticBar: true, menus: true, zoomSlider: true },
        disableAutoFocus: true,
      }),
    ];
  const core = UniverDocsCorePreset({
    container,
    header: true,
    toolbar: true,
    ribbonType: "classic",
    footer: true,
    toc: true,
    disableAutoFocus: true,
  });
  if (kind === "doc")
    return [
      core,
      {
        plugins: [
          [
            UniverDocsLayoutWorkerPlugin,
            {
              workerFactory: () =>
                new Worker(new URL("./doc-layout-worker.ts", import.meta.url), { type: "module" }),
            },
          ],
        ],
      },
      UniverDocsDrawingPreset({ collaboration: remote }),
      UniverDocsHyperLinkPreset(),
    ];
  return [
    {
      ...core,
      plugins: core.plugins.map((plugin) =>
        plugin === UniverFormulaEnginePlugin ? UniverProFormulaEnginePlugin : plugin,
      ),
    },
    {
      plugins: [
        [UniverDrawingPlugin, { override: remote ? [[IImageIoService, null]] : [] }],
        UniverDrawingUIPlugin,
        UniverShapePlugin,
        UniverShapeEditorPlugin,
        UniverShapeEditorUIPlugin,
        UniverSlidesPlugin,
        UniverSlidesUIPlugin,
      ],
    },
  ];
}
export { nativeLocales } from "./locales.ts";
