import { Schema } from "effect";
import { UniverType } from "@univerjs/protocol";
import { Count, Revision } from "@highchat/office-contract";
import { NativeSnapshot, NativeValue } from "./wire.ts";

/** Private metadata only. Real host authority and published-piece access remain mandatory. */
export const DOC_READ_LIMITS = Object.freeze({
  pieceBytes: 4 * 1024 * 1024,
  historyPage: 8,
});
const Name = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const DocReadRequest = Schema.Union([
  Schema.Struct({ method: Schema.Literal("unit") }),
  Schema.Struct({ method: Schema.Literal("snapshot"), revision: Revision }),
  Schema.Struct({ method: Schema.Literal("history"), after: Revision, to: Revision }),
]);
export type DocReadRequest = typeof DocReadRequest.Type;
/** Exact finite SDK UnitRecord fields; never synthesized from a snapshot or catalog. */
export const DocUnit = Schema.Struct({
  unitID: Name,
  type: Schema.Literal(UniverType.UNIVER_DOC),
  headRevision: Revision,
  creatorID: Name,
  createdAt: Count,
});
export type DocUnit = typeof DocUnit.Type;
export const DocChangeRow = Schema.Struct({
  revision: Revision,
  sid: Schema.NullOr(Name),
  reqId: Schema.NullOr(Count),
  value: NativeValue,
});
export const DocReadResult = Schema.Union([
  Schema.Struct({ method: Schema.Literal("unit"), unit: Schema.NullOr(DocUnit) }),
  Schema.Struct({
    method: Schema.Literal("snapshot"),
    manifest: Schema.NullOr(NativeSnapshot),
  }),
  Schema.Struct({
    method: Schema.Literal("history"),
    unit: Schema.Null,
    rows: Schema.Array(DocChangeRow).check(Schema.isMaxLength(0)),
  }),
  Schema.Struct({
    method: Schema.Literal("history"),
    unit: DocUnit,
    rows: Schema.Array(DocChangeRow).check(Schema.isMaxLength(DOC_READ_LIMITS.historyPage)),
  }),
]);
export type DocReadResult = typeof DocReadResult.Type;
