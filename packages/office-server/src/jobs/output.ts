import { Schema } from "effect";
import {
  Count,
  decodeWireSync,
  OfficeInvalid,
  safeFailure,
  type ArtifactRef,
} from "@starter/office-contract";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import type { IsolatedJob } from "../ports/jobs.ts";
import {
  decodeMutationCandidate,
  JOB_OUTPUT_LIMITS,
  requireBinding,
  requireSnapshot,
} from "./frames.ts";
import { JobBindingSchema } from "./schemas.ts";
import { SnapshotWithBlocksSchema } from "./snapshot-schema.ts";
import { exportMediaType } from "./media.ts";

const Envelope = { binding: JobBindingSchema };
const Image = Schema.Struct({ bytes: Schema.Uint8Array, width: Count, height: Count });
export const RenderOutputSchema = Schema.Struct({
  ...Envelope,
  images: Schema.Array(Image).check(Schema.isMinLength(1), Schema.isMaxLength(8)),
});
export const ImportedOutputSchema = Schema.Struct({
  ...Envelope,
  native: SnapshotWithBlocksSchema,
});
export const InspectionOutputSchema = Schema.Struct({ ...Envelope, result: Schema.Unknown });
const FileOutputSchema = Schema.Struct({
  ...Envelope,
  bytes: Schema.Uint8Array,
  mediaType: Schema.String,
});

/** Hostile bytes are bound and bounded before becoming immutable private job output, not a commit. */
export function validateJobOutput(
  job: IsolatedJob,
  wire: Uint8Array,
): {
  readonly bytes: Uint8Array;
  readonly kind: ArtifactRef["kind"];
  readonly mediaType: string;
} {
  if (job.kind === "execute") {
    decodeMutationCandidate(wire, job.binding);
    return {
      bytes: wire,
      kind: "native-proposal",
      mediaType: "application/vnd.office.mutation-candidate+msgpack",
    };
  }
  const payload = decodeNativeFrame(wire, "job-output", JOB_OUTPUT_LIMITS).payload;
  if (job.kind === "import") {
    const output = decodeWireSync(ImportedOutputSchema)(payload);
    requireBinding(output.binding, job.binding);
    requireSnapshot(output.native, job.binding);
    return {
      bytes: wire,
      kind: "native-input",
      mediaType: "application/vnd.office.import-result+msgpack",
    };
  }
  if (job.kind === "export") {
    const output = decodeWireSync(FileOutputSchema)(payload);
    requireBinding(output.binding, job.binding);
    if (
      output.mediaType !== exportMediaType(job.options) ||
      output.bytes.byteLength > 10 * 1024 * 1024
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    if (
      ["xlsx", "docx", "pptx"].includes(job.options.format) &&
      (output.bytes[0] !== 80 || output.bytes[1] !== 75 || output.bytes.byteLength < 22)
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    return { bytes: output.bytes, kind: "export", mediaType: output.mediaType };
  }
  if (job.kind === "inspect") {
    if (wire.byteLength > 64 * 1024) throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
    const output = decodeWireSync(InspectionOutputSchema)(payload);
    requireBinding(output.binding, job.binding);
    return {
      bytes: wire,
      kind: "inspection",
      mediaType: "application/vnd.office.inspection+msgpack",
    };
  }
  const output = decodeWireSync(RenderOutputSchema)(payload);
  requireBinding(output.binding, job.binding);
  let pixels = 0,
    total = 0;
  for (const image of output.images) {
    const view = new DataView(image.bytes.buffer, image.bytes.byteOffset, image.bytes.byteLength);
    if (
      image.width < 1 ||
      image.height < 1 ||
      image.bytes.byteLength < 24 ||
      [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => image.bytes[index] !== byte) ||
      view.getUint32(16) !== image.width ||
      view.getUint32(20) !== image.height
    )
      throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
    pixels += image.width * image.height;
    total += image.bytes.byteLength;
    if (pixels > 16_000_000 || total > 16 * 1024 * 1024)
      throw new OfficeInvalid(safeFailure("LIMIT_EXCEEDED"));
  }
  const [single] = output.images;
  return output.images.length === 1 && single !== undefined
    ? { bytes: single.bytes, kind: "render", mediaType: "image/png" }
    : { bytes: wire, kind: "render", mediaType: "application/vnd.office.render-bundle+msgpack" };
}
