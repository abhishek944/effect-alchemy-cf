import { Schema } from "effect";
import type { NativeDatabase } from "./database.ts";
import type { NativePayloads } from "./payloads.ts";
import type { NativeReferenceReads } from "./reference-reads.ts";
import type {
  NativePieceRef,
  NativeReadOrigin,
  NativeSnapshotRefs,
  NativeValueRef,
} from "./types.ts";
import { NativeStorageError, metadata } from "./types.ts";
import { readPiece } from "./ref-shapes.ts";
import { objectFields, parseMetadata } from "./metadata-parse.ts";

const Positive = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1));
const Name = Schema.String.check(Schema.isMaxLength(256));
const Origin = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("snapshot"), revision: Positive }),
  Schema.Struct({ kind: Schema.Literal("seed"), worktreeID: Name }),
  Schema.Struct({
    kind: Schema.Literal("merge-artifact"),
    worktreeID: Name,
    readyRevision: Positive,
  }),
  Schema.Struct({ kind: Schema.Literal("changeset"), branch: Name, revision: Positive }),
]);
function contains(value: NativeValueRef, piece: NativePieceRef): boolean {
  return value.parts.some(
    (part) => part.key === piece.key && part.digest === piece.digest && part.bytes === piece.bytes,
  );
}
function manifestContains(value: NativeSnapshotRefs | null, piece: NativePieceRef): boolean {
  return (
    value !== null &&
    (contains(value.snapshot, piece) || value.blocks.some((block) => contains(block.value, piece)))
  );
}
async function authorized(
  reads: NativeReferenceReads,
  origin: NativeReadOrigin,
  piece: NativePieceRef,
): Promise<boolean> {
  switch (origin.kind) {
    case "snapshot": {
      const manifest = await reads.snapshot(origin.revision);
      return manifest?.revision === origin.revision && manifestContains(manifest, piece);
    }
    case "seed":
      return manifestContains(await reads.seed(origin.worktreeID), piece);
    case "merge-artifact": {
      const artifact = await reads.mergeArtifact(origin.worktreeID);
      return (
        artifact?.readyDraftHeadRevision === origin.readyRevision &&
        manifestContains(artifact.manifest, piece)
      );
    }
    case "changeset": {
      const row = (await reads.changesets(origin.branch, origin.revision - 1, 1))[0];
      return row?.revision === origin.revision && contains(row.value, piece);
    }
  }
  throw new NativeStorageError("CONTENT", "Unknown published origin");
}
/** A part reference is integrity metadata, never a bearer grant. Revalidate its indexed origin. */
export async function loadPublishedPiece(
  db: NativeDatabase,
  payloads: NativePayloads,
  reads: NativeReferenceReads,
  inputOrigin: NativeReadOrigin,
  inputPiece: NativePieceRef,
): Promise<Uint8Array> {
  const origin = parseMetadata(
    Origin,
    objectFields(inputOrigin, ["kind", "revision", "worktreeID", "readyRevision", "branch"]),
  );
  const piece = readPiece(inputPiece);
  // Serialize only the strict bounded DTO; never context or arbitrary extra fields.
  metadata(origin);
  metadata(piece);
  await db.assertReadable();
  if (!(await authorized(reads, origin, piece)))
    throw new NativeStorageError(
      "SCOPE",
      "Piece is not reachable from the granted published origin",
    );
  const bytes = await payloads.loadPiece(piece);
  if (!(await authorized(reads, origin, piece)))
    throw new NativeStorageError("FENCE", "Published origin became unavailable during read");
  return bytes;
}
