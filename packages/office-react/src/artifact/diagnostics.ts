import * as Core from "@univerjs/core";
import * as Render from "@univerjs/engine-render";
import * as Docs from "@univerjs/docs";
import * as DocsUI from "@univerjs/docs-ui";
import * as Drawing from "@univerjs/drawing";
import * as DrawingUI from "@univerjs/drawing-ui";
import * as DrawingPreset from "@univerjs/preset-docs-drawing";
import * as Slides from "@univerjs-pro/slides";
import * as SlidesUI from "@univerjs-pro/slides-ui";
import * as Shape from "@univerjs-pro/engine-shape";
import * as Formula from "@univerjs-pro/engine-formula";
import * as ShapeEditor from "@univerjs-pro/shape-editor";
import * as ShapeEditorUI from "@univerjs-pro/shape-editor-ui";

/** Match actual error names to public exports only; never inspect or stub private services. */
export function nativePublicDiagnostic(message: string) {
  const names = [...message.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  const modules: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
    Core,
    Render,
    Docs,
    DocsUI,
    Drawing,
    DrawingUI,
    DrawingPreset,
    Slides,
    SlidesUI,
    Shape,
    Formula,
    ShapeEditor,
    ShapeEditorUI,
  };
  const matches: string[] = [];
  for (const [module, exports] of Object.entries(modules))
    for (const [name, value] of Object.entries(exports)) {
      if (typeof value === "function" && names.includes(value.name))
        matches.push(`${module}.${name}`);
    }
  return matches;
}
