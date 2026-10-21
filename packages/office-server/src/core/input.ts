import { Effect } from "effect";
import { decodeWire, type Kind } from "@starter/office-contract";
import type { NativeAccess, OfficeDependencies, ViewRecord } from "../ports/index.ts";
import { SnapshotWithBlocksSchema } from "../jobs/snapshot-schema.ts";
import { snapshotDigest } from "../jobs/frames.ts";
import { materializeRevision, type NativeLoadPreflight } from "./native-materialize.ts";
import { loadNativeArtifact } from "./bytes.ts";
import { officeFailure } from "./failure.ts";
import { nativeTypes } from "./target.ts";
import type { OfficeNativeRuntime } from "./native-runtime.ts";

/** Historical immutable reads only; caller pins basis/claims before launch and rechecks at commit. */
export const materializeView = Effect.fn("Office.materializeView")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  record: ViewRecord,
) {
  if (record.source.kind === "artifact") {
    const raw = yield* loadNativeArtifact(
      deps,
      record.owner,
      record.source.artifact,
      "merge-artifact",
    );
    const native = yield* decodeWire(SnapshotWithBlocksSchema)(raw).pipe(
      Effect.mapError(() => officeFailure("CONTENT_REQUIRED")),
    );
    if (
      native.snapshot.unitID !== record.target.unitId ||
      native.snapshot.rev !== record.view.revision ||
      native.snapshot.type !== nativeTypes[record.view.kind]
    )
      return yield* Effect.fail(officeFailure("CONTENT_REQUIRED"));
    yield* Effect.try({
      try: () => snapshotDigest(native),
      catch: () => officeFailure("LIMIT_EXCEEDED"),
    });
    return native;
  }
  return yield* materializeNativeSnapshot(
    deps,
    runtime,
    {
      kind: "read",
      target: record.target,
      authorityEpoch: record.authorityEpoch,
      serviceEpoch: record.serviceEpoch,
    },
    record.source.kind === "draft" ? record.source.worktreeId : null,
    record.view.kind,
    record.source.revision,
  );
});
export const materializeNativeSnapshot = Effect.fn("Office.materializeNativeSnapshot")(function* (
  deps: OfficeDependencies,
  runtime: OfficeNativeRuntime,
  access: Extract<NativeAccess, { kind: "read" }>,
  worktreeId: string | null,
  kind: Kind,
  revision: number,
  preflight?: NativeLoadPreflight,
) {
  return yield* runtime.invoke(access, worktreeId, "read", null, (services) =>
    materializeRevision(
      services,
      access.target.owner.ownerId,
      access.target.unitId,
      worktreeId,
      kind,
      revision,
      deps.policy.limits,
      preflight,
    ),
  );
});
