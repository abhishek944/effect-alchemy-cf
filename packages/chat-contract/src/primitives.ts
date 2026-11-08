import { Schema } from "effect";

export const Id = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{16,96}$/));
export const Count = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER),
);
/** Every untrusted reference payload decodes with excess-field rejection. */
export const decodeWire = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.decodeUnknownEffect(schema, { onExcessProperty: "error" });
export const decodeWireSync = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: "error" });
