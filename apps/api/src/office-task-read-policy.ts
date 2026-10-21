import { Effect } from "effect";
import type { NativeAccess, OfficeMetadata } from "@starter/office-server/ports";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { assertOfficeTaskCommand } from "./office-task-command.ts";

/** Scope only. Does not replace actual native placement/epoch/fence or View snapshot policy. */
export async function assertOfficeTaskRead(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  access: NativeAccess,
): Promise<void> {
  const original = request.original;
  if (!("task" in original)) return;
  if (
    access.kind === "editor" ||
    request.command === null ||
    request.command.method === "office.receipt"
  )
    throw officeDenied();
  assertOfficeTaskCommand(original.task.proof, request.command);
  if (access.kind !== "read") return; // Actual existing held turn + Task basis guard own writes.
  await request.live();
  const target = access.target;
  if (!officeSame(target.owner, original.actor.owner)) throw officeDenied();
  const document = await Effect.runPromise(
    metadata.document(original.actor.owner, target.documentId),
  );
  if (
    document === null ||
    !officeSame(document.owner, target.owner) ||
    document.document.id !== target.documentId ||
    document.unitId !== target.unitId
  )
    throw officeDenied();
  const bound = original.actor.target;
  let allowed = false;
  if (bound !== null && bound.documentId === target.documentId) {
    if (target.scope.kind === "draft") {
      const draft = await Effect.runPromise(metadata.draft(target.owner, target.scope.draftId));
      allowed =
        bound.draftId === target.scope.draftId &&
        bound.generation === target.scope.generation &&
        draft !== null &&
        officeSame(draft.owner, target.owner) &&
        draft.documentId === target.documentId &&
        draft.generation === bound.generation;
    } else allowed = request.command.method === "office.ready"; // Current main comparison, not main mutation.
  }
  for (const selected of [original.task.binding.readView, original.task.binding.fork]) {
    if (
      selected === null ||
      selected.source.kind === "artifact" ||
      !officeSame(selected.target, target)
    )
      continue;
    const actual = await Effect.runPromise(metadata.view(target.owner, selected.view.id));
    if (
      actual !== null &&
      actual.view.expiresAt > Date.now() &&
      officeSame(actual.target, selected.target) &&
      officeSame(actual.source, selected.source) &&
      actual.view.revision === selected.view.revision
    )
      allowed = true;
  }
  const command = original.task.proof.association.intent.command;
  if (!allowed && (command.command === "create" || command.command === "create-draft")) {
    const operation = await Effect.runPromise(
      metadata.operation(target.owner, command.input.operationId),
    );
    if (
      operation !== null &&
      officeSame(operation.actor, original.actor) &&
      operation.intent.kind === command.command &&
      officeSame(operation.intent.input, command.input) &&
      operation.documentId === target.documentId &&
      operation.unitId === target.unitId &&
      target.scope.kind === "draft" &&
      target.scope.generation === 1 &&
      operation.receipt.draftId === target.scope.draftId
    ) {
      const draft = await Effect.runPromise(metadata.draft(target.owner, target.scope.draftId));
      allowed =
        draft !== null &&
        officeSame(draft.owner, target.owner) &&
        draft.documentId === target.documentId &&
        draft.generation === 1 &&
        draft.originOperationId === operation.receipt.operationId &&
        draft.worktreeId === operation.worktreeId;
    }
  }
  if (!allowed) throw officeDenied();
  await request.live();
}
