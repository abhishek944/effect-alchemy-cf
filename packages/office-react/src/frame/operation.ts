import type { NativeApplication } from "./native.ts";
import type { nativeLifecycle } from "./lifecycle.ts";
import type { nativeCaptures } from "./captures.ts";
import type { FrameRequest } from "./messages.ts";
import { selectionFields } from "./selection.ts";

/** Runs inside the existing frame serial queue; prepare intentionally leaves native input held. */
export async function performFrameOperation(
  request: Extract<FrameRequest, { kind: "request" }>,
  native: NativeApplication,
  lifecycle: ReturnType<typeof nativeLifecycle>,
  captures: ReturnType<typeof nativeCaptures>,
  revision: number,
) {
  if (request.action === "prepare-capture") {
    captures.validate(request.capture);
    const confirmed = await lifecycle.hold();
    captures.validate(request.capture);
    return { revision: confirmed };
  }
  if (request.action === "validate-capture") {
    captures.validate(request.capture);
    return { revision };
  }
  if (request.action === "reveal-capture") {
    await captures.reveal(request.capture);
    return { revision };
  }
  const extra = request.action === "hold" ? selectionFields(native, captures.unitId) : {};
  if (request.action === "resume") lifecycle.resume();
  else revision = await lifecycle[request.action]();
  return { revision, ...extra };
}
