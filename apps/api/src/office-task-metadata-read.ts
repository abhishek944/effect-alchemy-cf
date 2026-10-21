import { Effect } from "effect";
import type { OfficeMetadata, OperationRecord } from "@starter/office-server/ports";
import type { OfficeMetadataCall } from "./office-metadata-dispatch.ts";
import type { OfficeTaskAcknowledged } from "./office-task-metadata-record.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { assertOfficeTaskView } from "./office-task-metadata-view.ts";
import { officeTaskReviewGraph } from "./office-task-review.ts";
import { assertOfficeTaskDescriptorReview } from "./office-task-descriptor.ts";

/** Finite read authorization. The original caller owns command/owner/operation proof. */
export async function authorizeOfficeTaskMetadataRead(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  call: OfficeMetadataCall,
  acknowledged: OfficeTaskAcknowledged,
  operation: () => Promise<OperationRecord | null>,
): Promise<boolean> {
  const original = request.original;
  const command = request.command;
  if (!("task" in original) || command === null) throw officeDenied();
  const owner = original.actor.owner;
  const id = "operationId" in command.input ? command.input.operationId : null;
  switch (call.method) {
    case "metadata.document":
    case "metadata.documents":
    case "metadata.editors":
    case "metadata.publicationBarrier":
      return true; // Owner-bound descriptive metadata, not content/editor/native authority.
    case "metadata.draft": {
      const discovery = original.task.binding.discovery;
      if (
        discovery !== undefined &&
        call.input.draftId !== discovery.draftId &&
        !discovery.rows.some((row) => row.id === call.input.draftId)
      )
        throw officeDenied();
      return true;
    }
    case "metadata.drafts":
      if (command.method !== "office.drafts" || call.input.cursor !== command.input.cursor)
        throw officeDenied();
      return true;
    case "metadata.operation":
    case "metadata.writes":
      if (call.input.operationId !== id) throw officeDenied();
      await operation();
      return true;
    case "metadata.view":
    case "metadata.historicalViewTarget": {
      const graph = await officeTaskReviewGraph(metadata, request);
      if (graph !== null) {
        if (!graph.roles.some(({ record }) => record.view.id === call.input.viewId))
          throw officeDenied();
        return true;
      }
      const selected = original.task.binding.readView ?? original.task.binding.fork;
      if (selected?.view.id === call.input.viewId) return true;
      const op = id === null ? null : await operation();
      if (
        (op?.intent.kind === "render" || op?.intent.kind === "export") &&
        op.intent.input.viewId === call.input.viewId
      )
        return true;
      if (command.method === "office.ready" && call.method === "metadata.view") {
        const view = await Effect.runPromise(metadata.view(owner, call.input.viewId));
        if (view !== null) {
          await assertOfficeTaskView(metadata, request, original, view, acknowledged);
          return true;
        }
      }
      throw officeDenied();
    }
    case "metadata.review": {
      if (command.method === "office.review") {
        const graph = await officeTaskReviewGraph(metadata, request);
        if (
          graph === null ||
          command.input.reviewId !== call.input.reviewId ||
          graph.review.id !== call.input.reviewId
        )
          throw officeDenied();
        return true;
      }
      if (original.task.binding.discovery !== undefined) {
        const review = await Effect.runPromise(metadata.review(owner, call.input.reviewId));
        if (review !== null) await assertOfficeTaskDescriptorReview(metadata, request, review);
        return true;
      }
      const review = await Effect.runPromise(metadata.review(owner, call.input.reviewId));
      if (review === null) return true;
      const bound = original.actor.target;
      if (
        bound === null ||
        review.documentId !== bound.documentId ||
        review.generation !== bound.generation ||
        review.draftRevision !== bound.expectedRevision
      )
        throw officeDenied();
      return true;
    }
    case "metadata.job": {
      const saved = await Effect.runPromise(metadata.job(owner, call.input.jobId));
      if (saved === null) return true;
      if (saved.job.kind === "inspect") {
        if (
          command.method !== "office.inspect" ||
          saved.job.viewId !== command.input.viewId ||
          !officeSame(saved.job.query, command.input.query)
        )
          throw officeDenied();
      } else if (
        saved.job.binding.operationId !== id ||
        (await operation())?.jobId !== call.input.jobId
      )
        throw officeDenied();
      return true;
    }
    default:
      return false;
  }
}
