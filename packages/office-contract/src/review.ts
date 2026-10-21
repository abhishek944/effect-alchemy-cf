import { Schema } from "effect";
import { Count, Cursor, Digest, Id, Label, Scalar } from "./primitives.ts";
import { View } from "./models.ts";

export const LeafValue = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("scalar"), value: Scalar }),
  Schema.Struct({
    kind: Schema.Literal("native-view"),
    viewId: Id,
    reason: Schema.Literals(["complex", "oversize", "unsupported", "absent"]),
  }),
]);
export const Change = Schema.Struct({
  id: Label,
  stableId: Label,
  parentId: Schema.NullOr(Label),
  entityType: Label,
  kind: Schema.Literals(["insert", "delete", "update"]),
  moved: Schema.Boolean,
  path: Schema.Array(Label).check(Schema.isMaxLength(32)),
  leaves: Schema.Array(
    Schema.Struct({
      path: Schema.Array(Label).check(Schema.isMaxLength(32)),
      before: LeafValue,
      after: LeafValue,
    }),
  ).check(Schema.isMaxLength(100)),
});
export const ReviewPage = Schema.Struct({
  reviewId: Id,
  fingerprint: Digest,
  documentId: Id,
  main: Schema.NullOr(View),
  baseline: Schema.NullOr(View),
  draft: Schema.NullOr(View),
  result: Schema.NullOr(View),
  fidelity: Schema.Literals(["history", "snapshot"]),
  readiness: Schema.Literals(["ready", "degraded"]),
  diagnostics: Schema.Array(Label).check(Schema.isMaxLength(32)),
  totalChanges: Count,
  changes: Schema.Struct({
    items: Schema.Array(Change).check(Schema.isMaxLength(100)),
    next: Cursor,
  }),
  approval: Schema.Literals(["available", "stale", "incomplete", "conflict"]),
});
export type ReviewPage = typeof ReviewPage.Type;
