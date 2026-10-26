import { Schema } from "effect";
import { Count, Id, OfficeNativeReferenceContext, decodeWireSync } from "@starter/office-contract";

/** Frame-local observation, never a claimed saved revision or source authority. */
export type NativeSelectionCapture = Readonly<{
  captureId: string;
  viewId: string;
  unitId: string;
  contentEpoch: number;
  context: Exclude<OfficeNativeReferenceContext, { kind: "whole" }>;
}>;
export const NativeSelectionCaptureSchema = Schema.Struct({
  captureId: Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/)),
  viewId: Id,
  unitId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  contentEpoch: Count,
  context: OfficeNativeReferenceContext.check(Schema.makeFilter((value) => value.kind !== "whole")),
});
const decode = decodeWireSync(NativeSelectionCaptureSchema);
/** Clone and freeze every nested field before crossing an asynchronous boundary. */
export function freezeNativeCapture(input: unknown): NativeSelectionCapture {
  const capture = decode(input);
  if (capture.context.kind === "whole") throw new Error("A selection capture requires a scope.");
  const context =
    capture.context.kind === "sheet-range"
      ? Object.freeze({
          ...capture.context,
          ranges: Object.freeze(capture.context.ranges.map((r) => Object.freeze({ ...r }))),
        })
      : Object.freeze({ ...capture.context });
  return Object.freeze({ ...capture, context });
}
