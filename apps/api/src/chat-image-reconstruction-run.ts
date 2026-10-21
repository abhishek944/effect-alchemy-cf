import { ImageInputReconstruction } from "./chat-image-reconstruction.ts";
import type {
  ImageReconstructionAccess,
  ImageReconstructionContext,
} from "./chat-image-reconstruction-entry.ts";

/** Parent keeps readiness/admission closed; exhaustion is never readiness. */
export async function reconstructPendingImageInputs(
  access: ImageReconstructionAccess,
  context: ImageReconstructionContext,
): Promise<boolean> {
  const scanner = new ImageInputReconstruction(access);
  for (let step = 0; step < 256; step += 1) {
    const result = await scanner.step(context);
    if (result.status !== "progress") return result.status === "ready";
  }
  return false;
}
