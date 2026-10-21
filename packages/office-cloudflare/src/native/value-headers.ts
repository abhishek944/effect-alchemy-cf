import { Schema } from "effect";
import type { IChangeset, ISheetBlock, ISnapshot } from "@univerjs/protocol";
import { NativeName, NativeType, Natural, objectFields, parseMetadata } from "./metadata-parse.ts";
import { digest, metadata, nativeLimits, NativeStorageError } from "./types.ts";

const Hex = Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const SnapshotHeader = Schema.Struct({
  kind: Schema.Literal("snapshot"),
  unitID: NativeName,
  type: NativeType,
  revision: Natural,
  requiredBlocksDigest: Hex,
});
const BlockHeader = Schema.Struct({
  kind: Schema.Literal("block"),
  blockID: NativeName,
  startRow: Natural,
  endRow: Natural,
});
const ChangeHeader = Schema.Struct({
  kind: Schema.Literal("changeset"),
  unitID: NativeName,
  type: NativeType,
  baseRev: Natural,
  revision: Natural,
  sid: Schema.NullOr(Schema.String.check(Schema.isMaxLength(256))),
  reqId: Schema.NullOr(Natural),
});
export type NativeValueHeader =
  | {
      readonly kind: "snapshot";
      readonly unitID: string;
      readonly type: ISnapshot["type"];
      readonly revision: number;
      readonly requiredBlocksDigest: string;
    }
  | {
      readonly kind: "block";
      readonly blockID: string;
      readonly startRow: number;
      readonly endRow: number;
    }
  | {
      readonly kind: "changeset";
      readonly unitID: string;
      readonly type: IChangeset["type"];
      readonly baseRev: number;
      readonly revision: number;
      readonly sid: string | null;
      readonly reqId: number | null;
    };
export async function blockIdentityDigest(blocks: readonly string[]): Promise<string> {
  const ids = [...new Set(blocks)].toSorted();
  if (ids.length > nativeLimits.blocks)
    throw new NativeStorageError("LIMIT", "Too many native block dependencies");
  return digest(
    new TextEncoder().encode(
      metadata(["office-native-block-ids", 1, ids], nativeLimits.manifestBytes),
    ),
  );
}
export async function snapshotHeader(value: ISnapshot): Promise<NativeValueHeader> {
  return {
    kind: "snapshot",
    unitID: value.unitID,
    type: value.type,
    revision: value.rev,
    requiredBlocksDigest: await blockIdentityDigest(
      Object.values(value.workbook?.blockMeta ?? {}).flatMap((entry) => entry.blocks),
    ),
  };
}
export function blockHeader(value: ISheetBlock): NativeValueHeader {
  return { kind: "block", blockID: value.id, startRow: value.startRow, endRow: value.endRow };
}
export function changesetHeader(value: IChangeset): NativeValueHeader {
  return {
    kind: "changeset",
    unitID: value.unitID,
    type: value.type,
    baseRev: value.baseRev,
    revision: value.revision,
    sid: value.sid ?? null,
    reqId: value.reqId ?? null,
  };
}
export function readValueHeader(input: unknown): NativeValueHeader {
  const discriminant = objectFields(input, [
    "kind",
    "unitID",
    "type",
    "revision",
    "requiredBlocksDigest",
    "blockID",
    "startRow",
    "endRow",
    "baseRev",
    "sid",
    "reqId",
  ]);
  const header =
    discriminant.kind === "snapshot"
      ? parseMetadata(SnapshotHeader, discriminant)
      : discriminant.kind === "block"
        ? parseMetadata(BlockHeader, discriminant)
        : parseMetadata(ChangeHeader, discriminant);
  if (
    (header.kind === "snapshot" && header.revision < 1) ||
    (header.kind === "block" && header.endRow < header.startRow) ||
    (header.kind === "changeset" && (header.baseRev < 1 || header.revision !== header.baseRev + 1))
  ) {
    throw new NativeStorageError("CONTENT", "Invalid native producer header");
  }
  return header;
}
