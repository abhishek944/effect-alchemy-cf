import { decodeWireSync, Change, type LeafValue } from "@starter/office-contract";
import {
  transformSnapshotToWorkbookData,
  transformSnapshotToDocumentData,
  transformSnapshotToSlideData,
} from "@univerjs-pro/collaboration";
import {
  createUnitComparisonEngine,
  UnitComparisonDetailLevel,
  UnitComparisonFidelity,
  UnitComparisonReadiness,
  type IUnitComparisonItem,
} from "@univerjs-pro/edit-history";
import { DocsUnitComparisonAdapter } from "@univerjs-pro/docs-history";
import { SheetsUnitComparisonAdapter } from "@univerjs-pro/sheets-history";
import { SlidesUnitComparisonAdapter } from "@univerjs-pro/slides-history";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import { OFFICE_NATIVE_TYPES } from "../jobs/runtime-factory.ts";
import type { ReadyCapture } from "./review-bundle.ts";
import { metadataDigest } from "./operations.ts";

async function unitData(
  capture: ReadyCapture,
  native: ISnapshotWithBlocks | null,
): Promise<unknown> {
  if (native === null) return null; // Genuine absent Unit, never a fabricated empty main.
  const owned = structuredClone(native);
  if (capture.kind === "sheet")
    return transformSnapshotToWorkbookData(owned.snapshot, owned.sheetBlocks);
  if (capture.kind === "doc") return transformSnapshotToDocumentData(owned.snapshot);
  return transformSnapshotToSlideData(owned.snapshot);
}
export async function sameReviewResult(
  capture: ReadyCapture,
  actual: ISnapshotWithBlocks,
  comparisonId: string,
): Promise<boolean> {
  if (capture.result === null) return capture.removed;
  const engine = createUnitComparisonEngine([
    new DocsUnitComparisonAdapter(),
    new SheetsUnitComparisonAdapter(),
    new SlidesUnitComparisonAdapter(),
  ]);
  const prepared = engine.prepare({
    comparisonId,
    unitId: capture.unitId,
    type: OFFICE_NATIVE_TYPES[capture.kind],
    fidelity: UnitComparisonFidelity.SNAPSHOT,
    leftData: await unitData(capture, capture.result),
    rightData: await unitData(capture, actual),
  });
  const result = engine.query(prepared, { limit: 1 });
  return (
    prepared.adapterResult.items.length === 0 &&
    result.summary.total === 0 &&
    result.diagnostics.readiness === UnitComparisonReadiness.READY &&
    result.diagnostics.unsupportedMutationIds.length === 0
  );
}
const marker = (
  viewId: string,
  reason: "absent" | "complex" | "oversize" | "unsupported",
): typeof LeafValue.Type => ({ kind: "native-view", viewId, reason });
function leaf(value: unknown, viewId: string): typeof LeafValue.Type {
  if (value === undefined) return marker(viewId, "absent");
  if (typeof value === "string" && new TextEncoder().encode(value).byteLength > 256)
    return marker(viewId, "oversize");
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value) && !Object.is(value, -0))
  )
    return { kind: "scalar", value };
  return marker(viewId, "complex");
}
function change(item: IUnitComparisonItem, before: string, after: string): typeof Change.Type {
  const base = {
    id: item.id,
    stableId: item.stableId,
    parentId: item.parentStableId ?? null,
    entityType: item.entityType,
    kind: item.kind,
    moved: item.moved,
    path: [...item.path],
  };
  const whole = () =>
    decodeWireSync(Change)({
      ...base,
      path: [],
      leaves: [{ path: [], before: marker(before, "oversize"), after: marker(after, "oversize") }],
    });
  if (item.changes.length > 100 || item.path.length > 32) return whole();
  const normalized = decodeWireSync(Change)({
    ...base,
    leaves: item.changes.map((value) => ({
      path: [...value.path],
      before: leaf(value.before, before),
      after: leaf(value.after, after),
    })),
  });
  try {
    metadataDigest(normalized, 6 * 1024);
    return normalized;
  } catch {
    return whole();
  }
}
/** All prepared native items are retained. SDK's default page is never mistaken for the complete result. */
export async function compareReview(
  capture: ReadyCapture,
  reviewId: string,
  beforeView: string,
  afterView: string,
) {
  const engine = createUnitComparisonEngine([
    new DocsUnitComparisonAdapter(),
    new SheetsUnitComparisonAdapter(),
    new SlidesUnitComparisonAdapter(),
  ]);
  const prepared = engine.prepare({
    comparisonId: reviewId,
    unitId: capture.unitId,
    type: OFFICE_NATIVE_TYPES[capture.kind],
    fidelity:
      capture.fidelity === "history"
        ? UnitComparisonFidelity.HISTORY
        : UnitComparisonFidelity.SNAPSHOT,
    ...(capture.baselineRevision === null ? {} : { commonBaseRevision: capture.baselineRevision }),
    leftData: await unitData(capture, capture.main),
    rightData: await unitData(capture, capture.result ?? capture.draft),
    leftChangesets: capture.leftChangesets,
    rightChangesets: capture.rightChangesets,
  });
  const projection = engine.query(prepared, {
    offset: 0,
    limit: 1,
    detail: UnitComparisonDetailLevel.CHANGES,
  });
  const changes = prepared.adapterResult.items.map((item) => change(item, beforeView, afterView));
  if (projection.summary.total !== changes.length)
    throw new RangeError("Incomplete native comparison");
  return {
    changes,
    totalChanges: changes.length,
    fidelity: projection.fidelity,
    readiness:
      projection.diagnostics.unsupportedMutationIds.length > 0
        ? UnitComparisonReadiness.DEGRADED
        : projection.diagnostics.readiness,
    diagnostics: [
      ...projection.diagnostics.codes,
      ...(projection.diagnostics.unsupportedMutationIds.length > 0
        ? ["unsupported-native-mutations"]
        : []),
    ],
  };
}
