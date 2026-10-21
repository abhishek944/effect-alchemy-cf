import { Schema } from "effect";

export const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,96}$/));
export const Digest = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
export const Count = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
export const Revision = Count.check(Schema.isGreaterThanOrEqualTo(1));
export const Title = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
);
export const Label = Schema.String.check(Schema.isMaxLength(512));
export const Cursor = Schema.NullOr(Schema.String.check(Schema.isMaxLength(256)));
export const Kind = Schema.Literals(["sheet", "doc", "slide"]);
export type Kind = typeof Kind.Type;
export const MainScope = Schema.Struct({ kind: Schema.Literal("main") });
export const DraftScope = Schema.Struct({
  kind: Schema.Literal("draft"),
  draftId: Id,
  generation: Count,
});
export const DocumentScope = Schema.Union([MainScope, DraftScope]);
export type DocumentScope = typeof DocumentScope.Type;
export const Target = Schema.Struct({ documentId: Id, scope: DocumentScope });
export type Target = typeof Target.Type;
export const DraftTarget = Schema.Struct({
  documentId: Id,
  draftId: Id,
  generation: Count,
  expectedRevision: Revision,
});
export type DraftTarget = typeof DraftTarget.Type;
export const Scalar = Schema.Union([
  Schema.Null,
  Schema.Boolean,
  Schema.Number.check(Schema.isFinite()),
  Label,
]);
export const OperationParams = Schema.Struct({ operationId: Id });
export const DocumentParams = Schema.Struct({ documentId: Id });
export const DraftParams = Schema.Struct({ draftId: Id });
export const ArtifactParams = Schema.Struct({ artifactId: Id });
export const PageQuery = Schema.Struct({ cursor: Schema.optional(Cursor) });
/** Every untrusted command, response and stored metadata decode uses excess-field rejection. */
export const decodeWire = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });
export const decodeWireSync = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" });
