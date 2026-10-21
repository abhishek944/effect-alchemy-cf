import { nativeValueDigest } from "@starter/office-server/native-remote";
import type { NativePartRequest, PublishedOrigin } from "@starter/office-server/native-remote";
import type { NativeValueRef } from "@starter/office-cloudflare/native";
import type { OfficeNativeHandle } from "./office-native-handle.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";

async function published(
  handle: OfficeNativeHandle,
  origin: PublishedOrigin,
): Promise<readonly NativeValueRef[]> {
  const reads = handle.reads;
  if (
    ("worktreeID" in origin && origin.worktreeID !== handle.worktreeId) ||
    (origin.kind === "changeset" && origin.branch !== "" && origin.branch !== handle.worktreeId)
  )
    throw officeDenied();
  if (origin.kind === "changeset") {
    const row = (await reads.changesets(origin.branch, origin.revision - 1, 1))[0];
    if (row?.revision !== origin.revision) throw officeDenied();
    return [row.value];
  }
  const artifact =
    origin.kind === "merge-artifact" ? await reads.mergeArtifact(origin.worktreeID) : null;
  const manifest =
    origin.kind === "snapshot"
      ? await reads.snapshot(origin.revision)
      : origin.kind === "seed"
        ? await reads.seed(origin.worktreeID)
        : artifact?.manifest;
  if (
    manifest === null ||
    manifest === undefined ||
    manifest.unitID !== handle.target.unitId ||
    (origin.kind === "snapshot" && manifest.revision !== origin.revision) ||
    (origin.kind === "merge-artifact" && artifact?.readyDraftHeadRevision !== origin.readyRevision)
  )
    throw officeDenied();
  return [manifest.snapshot, ...manifest.blocks.map((block) => block.value)];
}
/** Resolve a bounded published part, never an arbitrary key/digest or aggregate native document. */
export async function officeNativePart(handle: OfficeNativeHandle, input: NativePartRequest) {
  const eligible = await published(handle, input.origin);
  const key = JSON.stringify(input.origin);
  let index = handle.originCache?.key === key ? handle.originCache.values : undefined;
  if (index === undefined) {
    index = new Map<string, NativeValueRef>();
    for (const value of eligible) {
      handle.request.signal.throwIfAborted();
      index.set(await nativeValueDigest(value), value);
    }
    handle.originCache = { key, values: index }; // One metadata-only origin, cleared at actual scope close.
  }
  const value = index.get(input.valueDigest);
  if (value === undefined || !eligible.some((actual) => officeSame(actual, value)))
    throw officeDenied();
  const piece = value.parts[input.part];
  if (piece === undefined) throw officeDenied();
  let bytes: Uint8Array;
  if (handle.reader !== null) bytes = await handle.reader.loadPiece(input.origin, piece);
  else {
    const writer = handle.writer;
    if (writer === null || writer.kind !== "core") throw officeDenied();
    // Admitted Core writers legitimately see advanced main AND their own Worktree. Epoch-only
    // readonly facades cannot represent that combination; the actual fenced writer refs do.
    bytes = await writer.writer.references.payloads.loadPiece(piece);
    if (!(await published(handle, input.origin)).some((actual) => officeSame(actual, value)))
      throw officeDenied();
  }
  if (bytes.byteLength !== piece.bytes) throw officeDenied();
  return { piece, bytes };
}
