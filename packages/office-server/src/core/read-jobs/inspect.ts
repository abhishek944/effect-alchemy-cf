import { Effect } from "effect";
import { Inspection, InspectRequest, decodeWire } from "@starter/office-contract";
import type { Actor, OfficeDependencies } from "../../ports/index.ts";
import { JOB_OUTPUT_LIMITS, requireBinding } from "../../jobs/frames.ts";
import { InspectionOutputSchema } from "../../jobs/output.ts";
import { decodeNativeFrame } from "@starter/office-contract/native-wire";
import { readArtifact } from "../bytes.ts";
import { isOfficeError, officeFailure } from "../failure.ts";
import type { OfficeNativeRuntime } from "../native-runtime.ts";
import { boundedMetadataDigest } from "../operations.ts";
import { lookupView } from "../views.ts";
import { freshView, observeReadJob, prepareReadJob, viewIdentity } from "./job.ts";
import { inspectionEntries } from "./inspection.ts";

export const inspectView = Effect.fn("Office.inspect")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  actor: Actor,
  value: InspectRequest,
) {
  const input = yield* decodeWire(InspectRequest)(value).pipe(
    Effect.mapError(() => officeFailure("INVALID_INPUT")),
  );
  if (
    (input.query.kind === "paragraphs" || input.query.kind === "slides") &&
    new Set(input.query.ids).size !== input.query.ids.length
  )
    return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const view = yield* lookupView(deps, actor, input.viewId);
  const expectedKind = ["workbook", "worksheet", "range"].includes(input.query.kind)
    ? "sheet"
    : ["document", "paragraphs"].includes(input.query.kind)
      ? "doc"
      : "slide";
  if (view.view.kind !== expectedKind) return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const id = yield* boundedMetadataDigest(
    [
      "office-inspection",
      1,
      viewIdentity(view),
      input.query,
      deps.policy.version,
      deps.policy.imageDigest,
    ],
    deps.policy.limits.metadataBytes,
  );
  let offset = 0;
  if (input.cursor !== null) {
    const match = /^([a-f0-9]{64}):([0-9]{1,7})$/.exec(input.cursor);
    if (match?.[1] !== id) return yield* Effect.fail(officeFailure("INVALID_INPUT"));
    offset = Number(match[2]);
    if (!Number.isSafeInteger(offset)) return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  }
  const { job } = yield* prepareReadJob(
    deps,
    runtime,
    actor,
    view,
    { kind: "inspect", viewId: input.viewId, query: input.query },
    id,
    id,
  );
  const state = yield* observeReadJob(deps, actor, view, job);
  if (state.state === "queued" || state.state === "running")
    return { viewId: input.viewId, entries: [], next: id + ":0", complete: false };
  if (state.state === "failed" || state.state === "execution-unknown")
    return yield* Effect.fail(officeFailure(state.error.code));
  if (state.state !== "succeeded") return yield* Effect.fail(officeFailure("OUTCOME_UNKNOWN"));
  if (state.output.kind !== "inspection" || state.output.bytes > 64 * 1024)
    return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
  // Read and hash before decoding; the immutable output is private, never an ordinary download.
  const wire = yield* readArtifact(deps, view.owner, state.output, 64 * 1024);
  const raw = yield* Effect.try({
    try: () =>
      decodeNativeFrame(wire, "job-output", { ...JOB_OUTPUT_LIMITS, maxBytes: 64 * 1024 }).payload,
    catch: () => officeFailure("CONTENT_REQUIRED"),
  });
  const output = yield* decodeWire(InspectionOutputSchema)(raw).pipe(
    Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
  );
  const mapped = yield* Effect.try({
    try: () => {
      requireBinding(output.binding, job.binding);
      return inspectionEntries(output.result, view.target.unitId, input.query);
    },
    catch: (error) => (isOfficeError(error) ? error : officeFailure("CONTENT_REQUIRED")),
  });
  if (offset > mapped.entries.length) return yield* Effect.fail(officeFailure("INVALID_INPUT"));
  const entries: (typeof Inspection.Type.entries)[number][] = [];
  let bytes = 512,
    end = offset;
  for (const entry of mapped.entries.slice(offset)) {
    const size = new TextEncoder().encode(JSON.stringify(entry)).byteLength + 1;
    if (bytes + size > deps.policy.limits.responseBytes || entries.length === 1000) break;
    bytes += size;
    entries.push(entry);
    end++;
  }
  if (end === offset && offset < mapped.entries.length)
    return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED"));
  yield* freshView(deps, actor, view);
  const page = yield* decodeWire(Inspection)({
    viewId: input.viewId,
    entries,
    next: end < mapped.entries.length ? id + ":" + String(end) : null,
    complete: end === mapped.entries.length && mapped.complete,
  }).pipe(Effect.mapError(() => officeFailure("CONTENT_REQUIRED")));
  if (new TextEncoder().encode(JSON.stringify(page)).byteLength > deps.policy.limits.responseBytes)
    return yield* Effect.fail(officeFailure("LIMIT_EXCEEDED"));
  return page;
});
