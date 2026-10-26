import { ArtifactRef, decodeWireSync, officeAttachmentIds } from "@starter/office-contract";
import type { OfficeResolution } from "@starter/office-pi";
import { officeStagingFailure } from "@starter/office-pi";
import { assertOfficeTaskUpload } from "./office-task-command.ts";
import { readOfficeStageReceipts } from "./chat-office-stage-receipts.ts";
import type { ChatOfficeTaskBroker, OfficeTaskLease } from "./chat-office-task-broker.ts";
import type { OfficeTaskProof } from "./office-task-proof.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeTaskFile } from "./office-task-file.ts";

/** The native ACK ledger owns upload observation. Missing ACK never permits replay. */
export function officeStageObserver(
  resolution: OfficeResolution,
  broker: ChatOfficeTaskBroker,
  lease: OfficeTaskLease,
  proof: OfficeTaskProof,
): (() => Promise<ArtifactRef | null>) | undefined {
  const command = resolution.intent.command;
  const stage = command.command === "stage-file" || command.command === "stage-code";
  const id = stage
    ? command.input.operationId
    : command.command === "operation"
      ? command.operationId
      : null;
  const original = officeTaskFile(proof.association, resolution.intent.attachmentId);
  const attachmentUpload = original ? officeAttachmentIds(original.fileId).uploadId : null;
  if (
    id === null ||
    (!stage &&
      id !== attachmentUpload &&
      !proof.stagedArtifacts.some((item) => item.artifact.id === id))
  )
    return undefined;
  return async () => {
    try {
      const current = await broker.resolve(lease.id);
      if (current?.lease !== lease) throw officeDenied();
      const receipts = await readOfficeStageReceipts(resolution, current.association);
      const saved = receipts.find((item) => item.artifact.id === id);
      if (!saved) return null;
      const ref = decodeWireSync(ArtifactRef)(saved.artifact);
      if (stage) {
        assertOfficeTaskUpload(current, {
          operationId: ref.id,
          kind: command.command === "stage-code" ? "code" : "upload",
          filename: command.command === "stage-code" ? "office.js" : (original?.name ?? ""),
          bytes: ref.bytes,
          digest: ref.digest,
        });
        if (command.command === "stage-file" && saved.fileRef !== command.input.fileRef)
          throw officeDenied();
      } else if (id === attachmentUpload) {
        if (
          !original ||
          saved.fileRef !== original.fileId ||
          ref.kind !== "upload" ||
          ref.bytes !== original.byteSize ||
          ref.digest !== original.digest ||
          ref.mediaType !== "application/octet-stream"
        )
          throw officeDenied();
      }
      if ((await broker.resolve(lease.id))?.lease !== lease) throw officeDenied();
      return ref;
    } catch (error) {
      resolution.context.abortSignal?.throwIfAborted();
      throw officeStagingFailure(id, "upload-observation", true, error);
    }
  };
}
