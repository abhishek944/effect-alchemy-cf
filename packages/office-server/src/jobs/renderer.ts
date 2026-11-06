import {
  createUniverRenderRuntime,
  type UniverRenderRuntimeOptions,
  type UniverRenderRuntime,
} from "@univer-cli/univer-render-runtime";
import type {
  UnitScreenshotInput,
  UnitScreenshotResult,
  ScreenshotImage,
} from "@univer-cli/unit-screenshot";

export interface OfficeRendererOptions {
  readonly renderPageRoot: string;
  readonly browserExecutablePath: string;
  readonly runtimeLicense?: string;
  readonly signal?: AbortSignal;
}
function invalid(): never {
  throw new Error("Invalid Office render selection.");
}
const filename = (text: string) =>
  text.replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/gu, "");
const pageName = (page: number) => `page-${String(page).padStart(2, "0")}.png`;

/** Compose the public render runtime: unit-screenshot 1.0.3 cannot disable its default caps. */
async function capture(
  runtime: UniverRenderRuntime,
  input: UnitScreenshotInput,
): Promise<UnitScreenshotResult> {
  const images: ScreenshotImage[] = [];
  const signal = input.signal === undefined ? {} : { signal: input.signal };
  const scale = input.target?.scale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0) invalid();
  if (input.unitType === "sheet") {
    if (input.target?.kind !== "sheet-range") invalid();
    const range = input.target.range.trim().toUpperCase();
    const image = await runtime.render({
      ...input,
      ...signal,
      operation: {
        kind: "sheet-range",
        range,
        scale,
        ...(input.target.sheetName === undefined ? {} : { sheetName: input.target.sheetName }),
      },
    });
    images.push({
      ...image,
      mediaType: "image/png",
      range,
      ...(input.target.sheetName === undefined ? {} : { sheetName: input.target.sheetName }),
      name: `${input.target.sheetName === undefined ? "" : filename(input.target.sheetName) + "-"}${filename(range)}.png`,
    });
  } else if (input.unitType === "doc" || input.unitType === "slide") {
    const total =
      input.unitType === "doc"
        ? await runtime.getDocumentPageCount({ ...input, ...signal })
        : input.unitData.slideOrder.length;
    const selectors = input.target?.pages ?? Array.from({ length: total }, (_, index) => index + 1);
    const pages = selectors.map((page) =>
      typeof page === "number"
        ? page
        : input.unitType === "slide"
          ? input.unitData.slideOrder.indexOf(page) + 1
          : invalid(),
    );
    if (
      !pages.length ||
      new Set(pages).size !== pages.length ||
      pages.some((page) => !Number.isSafeInteger(page) || page < 1 || page > total)
    )
      invalid();
    for (const page of pages) {
      input.signal?.throwIfAborted();
      const image =
        input.unitType === "doc"
          ? await runtime.render({
              ...input,
              ...signal,
              operation: { kind: "doc-page", page, scale },
            })
          : await runtime.render({
              ...input,
              ...signal,
              operation: { kind: "slide-page", page, scale },
            });
      images.push({
        ...image,
        mediaType: "image/png",
        page,
        name: input.unitType === "doc" && page === 1 ? "view.png" : pageName(page),
      });
    }
  } else invalid(); // This application supports only Sheet, Doc and Slide selections.
  for (const image of images) {
    if (
      !Number.isSafeInteger(image.width) ||
      image.width < 1 ||
      !Number.isSafeInteger(image.height) ||
      image.height < 1 ||
      image.bytes.byteLength < 24
    )
      invalid();
  }
  return { images, unitId: input.unitData.id, unitType: input.unitType };
}

/** SDK Chromium uses --no-sandbox. Call only inside the real outer isolation boundary. */
export async function createOfficeRenderer(options: OfficeRendererOptions) {
  const runtimeOptions: UniverRenderRuntimeOptions = {
    renderPageRoot: options.renderPageRoot,
    browserExecutablePath: options.browserExecutablePath,
    env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/task", TMPDIR: "/tmp" },
    license: options.runtimeLicense ?? "",
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  };
  const runtime = await createUniverRenderRuntime(runtimeOptions);
  return {
    screenshots: { capture: (input: UnitScreenshotInput) => capture(runtime, input) },
    runtime,
    close: () => runtime.close(),
  };
}
