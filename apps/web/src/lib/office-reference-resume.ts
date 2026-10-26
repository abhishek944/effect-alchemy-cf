import type { OfficeEditorHandle } from "@starter/office-react";

/** Release only an acknowledged temporary hold; report any uncertain resume to its surface. */
export async function resumeOfficeReference(
  handle: OfficeEditorHandle,
  canResume: () => boolean,
  report: (message: string) => void,
) {
  try {
    await handle.resume();
    if (!canResume()) {
      handle.stopInput();
      throw new Error("Native authorization changed while resuming.");
    }
  } catch (error) {
    report("Native input could not be confirmed after resume. Keep this editor open.");
    throw error;
  }
}
