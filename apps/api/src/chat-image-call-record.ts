import {
  ImageCallRecord,
  ImageCallState,
  type ImageCallUpdate,
  type ImageCallView,
} from "./chat-image-call-schema.ts";
import { readImageCallCanonical } from "./chat-image-call-evidence.ts";
import { initialImageCallCost, mergeImageCallMetadata } from "./chat-image-call-cost.ts";
import { outputCount } from "./chat-image-call-codec.ts";
import { saveCallFiles } from "./chat-image-call-files.ts";
import type { ImageCallTable } from "./chat-image-call-table.ts";
import {
  CALL_STATE_BYTES,
  callJson,
  callParse,
  callValue,
  ImageCallError,
} from "./chat-image-call-values.ts";
import { SavedFile } from "./chat-library-schema.ts";

/** Called only inside the owning store's synchronous transaction. */
export function recordImageCall(
  table: ImageCallTable,
  old: ImageCallView,
  input: ImageCallUpdate,
): void {
  callJson(input, CALL_STATE_BYTES);
  const update = callValue(ImageCallRecord, input);
  if (
    (update.outcome.dispatched && !old.dispatched) ||
    (update.files.length > 0 && !old.dispatched)
  )
    throw new ImageCallError("conflict");
  const prepared = readImageCallCanonical(old.admission);
  if (update.metadata !== undefined) {
    const metadata = update.metadata;
    if (
      metadata.model !== prepared.route.model ||
      metadata.provider !== "cloudflare" ||
      (!old.dispatched && (metadata.cost.kind !== "unknown" || metadata.outputs.length !== 0))
    )
      throw new ImageCallError("conflict");
    for (const key of ["quality", "size"] as const) {
      const effective = prepared.effective.find(([name]) => name === key)?.[1];
      if (metadata[key] !== undefined && metadata[key] !== effective)
        throw new ImageCallError("conflict");
    }
  }
  const metadata = mergeImageCallMetadata(old.metadata, update.metadata);
  saveCallFiles(table.sql, old, update.files);
  const count = outputCount(table.sql, old.admission.key);
  let missingReceipt = false;
  if (update.status === "complete" && (update.outcome.uncertain || update.outcome.storageUncertain))
    throw new ImageCallError("conflict");
  if (metadata !== null) {
    for (const output of metadata.outputs) {
      const row = table.sql
        .exec<{ file_json: string }>(
          `SELECT file_json FROM chat_image_call_files
        WHERE call_key = ? AND output_index = ?`,
          old.admission.key,
          output.index,
        )
        .toArray()[0];
      if (row === undefined) {
        missingReceipt = true;
        continue;
      }
      const file = callValue(SavedFile, callParse(row.file_json, 16_384), "corrupt");
      if (
        file.byteSize !== output.bytes ||
        file.mediaType !== output.mimeType ||
        (output.width !== undefined && file.width !== output.width) ||
        (output.height !== undefined && file.height !== output.height)
      )
        throw new ImageCallError("conflict");
    }
  }
  // Late abort handlers cannot downgrade a completed call or erase its receipts/cost.
  const complete = old.status === "complete" || update.status === "complete";
  if (
    complete &&
    (metadata === null ||
      metadata.outputs.length === 0 ||
      count !== metadata.outputs.length ||
      missingReceipt)
  )
    throw new ImageCallError("conflict");
  const confirmsOutput = update.files.length > 0 || (update.metadata?.outputs.length ?? 0) > 0;
  const uncertain = complete
    ? false
    : update.outcome.uncertain || (old.outcome.uncertain && !confirmsOutput);
  const storageUncertain = complete
    ? false
    : update.outcome.storageUncertain ||
      (old.outcome.storageUncertain && update.files.length === 0);
  const failed = !complete;
  const state = callValue(ImageCallState, {
    // A terminal no-contact proof cannot be downgraded by stale cleanup/read repair.
    status: complete
      ? "complete"
      : !old.dispatched && old.status === "failed"
        ? "failed"
        : update.status,
    started: old.started,
    dispatched: old.dispatched,
    ownerFinalizationPending: old.ownerFinalizationPending,
    failureLatched:
      old.failureLatched || (failed && (old.dispatched || uncertain || storageUncertain)),
    outcome: {
      dispatched: old.dispatched,
      uncertain,
      storageUncertain,
      partial: old.outcome.partial || (!complete && (update.outcome.partial || count > 0)),
    },
    metadata,
    cost: metadata?.cost ?? initialImageCallCost(),
    outputCount: count,
  });
  table.write(old.admission.key, state);
}
