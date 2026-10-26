import type { ChatReferenceInputs } from "@starter/office-contract";

/** No explicit selection (or an explicit whole occurrence) retains historical whole hydration. */
export function originalReferenceSlices(
  inputs: ChatReferenceInputs | undefined,
  fileId: string,
): readonly { readonly start: number; readonly end: number }[] | undefined {
  const slices: { readonly start: number; readonly end: number }[] = [];
  for (const input of inputs ?? []) {
    if (input.kind !== "original" || input.fileId !== fileId) continue;
    if (input.text === undefined) return undefined;
    slices.push(input.text);
  }
  return slices.length === 0 ? undefined : slices;
}
