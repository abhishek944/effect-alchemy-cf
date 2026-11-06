import { Effect } from "effect";
import { decodeWire } from "@highchat/office-contract";
import type { ArtifactRef } from "@highchat/office-contract";
import { decodeNativeFrame } from "@highchat/office-contract/native-wire";
import type { OfficeDependencies, OwnerScope } from "../../ports/index.ts";
import { requireBinding } from "../../jobs/frames.ts";
import { exportMediaType } from "../../jobs/media.ts";
import { RenderOutputSchema } from "../../jobs/output.ts";
import { byteStream, readArtifact } from "../bytes.ts";
import { isOfficeError, officeFailure } from "../failure.ts";
import { sha256 } from "../operations.ts";
import type { ReadJob } from "./job.ts";
import { imageZip } from "./zip.ts";

function dimensions(bytes: Uint8Array) {
  if (
    bytes.byteLength < 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => bytes[index] !== byte)
  )
    throw officeFailure("INVALID_INPUT");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (width < 1 || height < 1) throw officeFailure("INVALID_INPUT");
  return { width, height };
}
export const ordinaryJobOutput = Effect.fn("Office.readJobs.output")(function* (
  deps: OfficeDependencies,
  owner: OwnerScope,
  job: Exclude<ReadJob, { kind: "inspect" }>,
  output: ArtifactRef,
) {
  if (output.kind !== job.kind)
    return yield* Effect.fail(officeFailure("INVALID_INPUT", job.binding.operationId));
  const wire = yield* readArtifact(deps, owner, output);
  if (job.kind === "export") {
    if (
      output.mediaType !== exportMediaType(job.options) ||
      (["xlsx", "docx", "pptx"].includes(job.options.format) &&
        (wire.byteLength < 22 || wire[0] !== 80 || wire[1] !== 75))
    )
      return yield* Effect.fail(officeFailure("INVALID_INPUT", job.binding.operationId));
    return output;
  }
  const count = job.selection.kind === "sheet" ? 1 : job.selection.pages.length;
  if (output.mediaType === "image/png") {
    yield* Effect.try({
      try: () => dimensions(wire),
      catch: () => officeFailure("INVALID_INPUT"),
    });
    if (count !== 1)
      return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED", job.binding.operationId));
    return output;
  }
  if (output.mediaType !== "application/vnd.office.render-bundle+msgpack")
    return yield* Effect.fail(officeFailure("INVALID_INPUT", job.binding.operationId));
  const raw = yield* Effect.try({
    try: () => decodeNativeFrame(wire, "job-output").payload,
    catch: () => officeFailure("INVALID_INPUT"),
  });
  const bundle = yield* decodeWire(RenderOutputSchema)(raw).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  yield* Effect.try({
    try: () => {
      requireBinding(bundle.binding, job.binding);
      for (const image of bundle.images) {
        const size = dimensions(image.bytes);
        if (size.width !== image.width || size.height !== image.height)
          throw officeFailure("INVALID_INPUT");
      }
      if (bundle.images.length !== count) throw officeFailure("LIMIT_EXCEEDED");
    },
    catch: (error) => (isOfficeError(error) ? error : officeFailure("INVALID_INPUT")),
  });
  const zip = yield* Effect.try({
    try: () => imageZip(bundle.images.map((image) => image.bytes)),
    catch: () => officeFailure("LIMIT_EXCEEDED"),
  });
  return yield* deps.bytes.put(owner, {
    id: "render-" + job.binding.jobId,
    kind: "render",
    mediaType: "application/zip",
    declaredBytes: zip.byteLength,
    expectedDigest: sha256(zip),
    body: byteStream(zip),
  });
});
