import { Effect } from "effect";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeMetadataCall } from "./office-metadata-dispatch.ts";
import type { OfficeTaskAcknowledged } from "./office-task-metadata-record.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { assertOfficeTaskCommand } from "./office-task-command.ts";
import { sameOfficeTaskInput } from "./office-task-lineage.ts";
import { assertOfficeTaskRecord, assertOfficeTaskJobRefs } from "./office-task-metadata-record.ts";
import { officeJobControlUnit } from "./office-job-repair.ts";
import { assertOfficeTaskReview, assertOfficeTaskView } from "./office-task-metadata-view.ts";
import { authorizeOfficeTaskMetadataRead } from "./office-task-metadata-read.ts";
export async function authorizeOfficeTaskMetadata(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  call: OfficeMetadataCall,
  acknowledged: OfficeTaskAcknowledged,
): Promise<void> {
  const original = request.original;
  if (!("task" in original)) return;
  const command = request.command;
  if (command === null || request.file !== null) throw officeDenied();
  assertOfficeTaskCommand(original.task.proof, command);
  const owner = original.actor.owner;
  const id = "operationId" in command.input ? command.input.operationId : null;
  const operation = async () => {
    if (id === null) throw officeDenied();
    const value = await Effect.runPromise(metadata.operation(owner, id));
    if (value !== null && !sameOfficeTaskInput(original.task.proof, value)) throw officeDenied();
    return value;
  };
  if (await authorizeOfficeTaskMetadataRead(metadata, request, call, acknowledged, operation))
    return;
  switch (call.method) {
    case "metadata.reserveDocument": {
      const intent = original.task.proof.association.intent.command;
      const record = call.input.record;
      if (
        intent.command !== "create" ||
        intent.input.destination !== "new-draft" ||
        original.task.observeOnly ||
        record.originOperationId !== id ||
        record.location !== "draft" ||
        record.document.revision !== null ||
        record.document.draftId === null ||
        record.document.title !== intent.input.title ||
        record.document.kind !==
          (intent.input.source.kind === "blank"
            ? intent.input.source.documentKind
            : intent.input.source.options.kind)
      )
        throw officeDenied();
      return;
    }
    case "metadata.reserveDraft": {
      const intent = original.task.proof.association.intent.command;
      const record = call.input.record;
      if (
        original.task.observeOnly ||
        record.originOperationId !== id ||
        record.generation !== 1 ||
        (intent.command !== "create" && intent.command !== "create-draft")
      )
        throw officeDenied();
      const document = await Effect.runPromise(metadata.document(owner, record.documentId));
      if (
        document === null ||
        (intent.command === "create"
          ? document.originOperationId !== id
          : original.task.binding.fork?.view.documentId !== record.documentId)
      )
        throw officeDenied();
      return;
    }
    case "metadata.reserveOperation":
    case "metadata.advanceOperation":
      if (original.task.observeOnly && call.method === "metadata.reserveOperation")
        throw officeDenied();
      await assertOfficeTaskRecord(metadata, request, original, call.input.record, acknowledged);
      return;
    case "metadata.putView":
      await assertOfficeTaskView(metadata, request, original, call.input.record, acknowledged);
      return;
    case "metadata.putReview":
      await assertOfficeTaskReview(metadata, request, original, call.input.review, acknowledged);
      return;
    case "metadata.reserveJob":
    case "metadata.advanceJob": {
      const job = call.input.record.job;
      if (job.kind === "inspect") {
        const view = original.task.binding.readView;
        if (
          command.method !== "office.inspect" ||
          view === null ||
          job.viewId !== command.input.viewId ||
          !officeSame(job.query, command.input.query) ||
          job.binding.documentId !== view.target.documentId ||
          job.binding.unitId !== view.target.unitId ||
          job.binding.baseRevision !== view.view.revision
        )
          throw officeDenied();
      } else {
        const op = await operation();
        if (
          job.binding.operationId !== id ||
          op === null ||
          job.binding.documentId !== op.documentId ||
          !(await officeJobControlUnit(op, job))
        )
          throw officeDenied();
      }
      await assertOfficeTaskJobRefs(metadata, original, call.input.record, acknowledged);
      if (original.task.observeOnly && call.method === "metadata.reserveJob") throw officeDenied();
      return; // Existing first-ACK job claims and actual physical cleanup remain mandatory.
    }
    case "metadata.advanceGeneration": {
      const op = await operation();
      if (
        op?.intent.kind !== "reopen" ||
        call.input.draftId !== op.intent.input.draftId ||
        call.input.expected !== op.intent.input.generation ||
        call.input.permit.operationId !== id
      )
        throw officeDenied();
      return;
    }
    case "metadata.stageWrite":
    case "metadata.confirmWrite":
      if (
        call.input.permit.operationId !== id ||
        (await operation()) === null ||
        (call.method === "metadata.stageWrite" && command.method === "office.receipt")
      )
        throw officeDenied();
      if (call.method === "metadata.stageWrite" && !acknowledged(call.input.write.payload))
        throw officeDenied();
      return;
    default:
      throw officeDenied(); // No editor/approval/merge/publication/queue/remote preparation authority.
  }
}
