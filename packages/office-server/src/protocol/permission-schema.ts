import { Schema } from "effect";
import { UnitObject, UnitAction } from "@univerjs/protocol";
const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
const AllowedRequest = Schema.Struct({
  objectID: NativeId,
  objectType: Schema.Enum(UnitObject),
  unitID: NativeId,
  actions: Schema.Array(Schema.Enum(UnitAction)).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(64),
  ),
});
export const BatchAllowed = Schema.Struct({
  requests: Schema.Array(AllowedRequest).check(Schema.isMinLength(1), Schema.isMaxLength(64)),
});
