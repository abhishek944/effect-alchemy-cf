import { Schema } from "effect";
import type { IChangeset, ISheetBlock } from "@univerjs/protocol";
import { NativeName, NativeType, Natural, objectFields, parseMetadata } from "./metadata-parse.ts";
import { NativeStorageError, nativeLimits } from "./types.ts";

const Text = Schema.String;
const List = <S extends Schema.Constraint>(schema: S) => Schema.Array(schema).pipe(Schema.mutable);
const Block = Schema.Struct({
  id: NativeName,
  startRow: Natural,
  endRow: Natural,
  data: Schema.Uint8Array,
});
const Changeset = Schema.Struct({
  unitID: NativeName,
  type: NativeType,
  baseRev: Natural,
  revision: Natural,
  userID: Text,
  memberID: Text,
  mutations: List(Schema.Struct({ id: NativeName, data: Text })),
  sid: Schema.optional(Text),
  reqId: Schema.optional(Natural),
  mutationSize: Schema.optional(Natural),
  additionalFields: Schema.optional(Text),
  createTime: Schema.optional(Natural),
});

export { readNativeSnapshot } from "./protocol-snapshot.ts";
export function readNativeBlock(input: unknown): ISheetBlock {
  const object = objectFields(input, ["id", "startRow", "endRow", "data"]);
  parseMetadata(Block, object);
  if (!Schema.is(Block)(object))
    throw new NativeStorageError("CONTENT", "Invalid native block metadata");
  const value = object;
  if (value.endRow < value.startRow || value.data.byteLength > nativeLimits.blockBytes) {
    throw new NativeStorageError("CONTENT", "Invalid native block metadata");
  }
  return value;
}
export function readNativeChangeset(input: unknown): IChangeset {
  const object = objectFields(input, [
    "unitID",
    "type",
    "baseRev",
    "revision",
    "userID",
    "mutations",
    "memberID",
    "sid",
    "reqId",
    "mutationSize",
    "additionalFields",
    "createTime",
  ]);
  parseMetadata(Changeset, object);
  if (!Schema.is(Changeset)(object))
    throw new NativeStorageError("CONTENT", "Invalid native changeset metadata");
  const value = object;
  if (value.baseRev < 1 || value.revision !== value.baseRev + 1)
    throw new NativeStorageError("CONTENT", "Native changeset revision/header mismatch");
  return value;
}
