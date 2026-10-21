import { createPresetRenderUniver, mountUniverRenderPage } from "@univer-cli/univer-render-page";

/** Browser-only native Render Page, separate from the SaaS editor and application authorization. */
export function mountOfficeRenderPage(container: HTMLElement) {
  return mountUniverRenderPage({ container, createUniver: createPresetRenderUniver });
}
