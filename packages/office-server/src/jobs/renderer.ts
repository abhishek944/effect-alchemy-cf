import {
  createUniverRenderRuntime,
  type UniverRenderRuntimeOptions,
} from "@univer-cli/univer-render-runtime";
import { createUnitScreenshot } from "@univer-cli/unit-screenshot";

export interface OfficeRendererOptions {
  readonly renderPageRoot: string;
  readonly browserExecutablePath: string;
  readonly runtimeLicense?: string;
  readonly signal?: AbortSignal;
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
  try {
    const screenshots = createUnitScreenshot({
      runtime,
      limits: { maxPages: 8, maxPixels: 16_000_000 },
    });
    return { screenshots, runtime, close: () => runtime.close() };
  } catch (error) {
    await runtime.close();
    throw error;
  }
}
