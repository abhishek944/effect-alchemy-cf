import { Effect } from "effect";
import { officeImportOptions, type ArtifactRef } from "@starter/office-contract";
import type { OfficeMetadata, OperationRecord, JobRecord } from "@starter/office-server/ports";
import type { OfficeTaskInvocation } from "./office-task-issuance.ts";
import type { OfficePrivateRequest } from "./office-private-authority.ts";
import { officeDenied, officeSame } from "./office-private-authority.ts";
import { sameOfficeTaskInput } from "./office-task-lineage.ts";
import { assertOfficeTaskObservedIntent } from "./office-task-command.ts";
import { officeTaskStagedRef } from "./office-task-proof.ts";

export type OfficeTaskAcknowledged = (ref: ArtifactRef) => boolean;
export function officeTaskOriginalRef(original: OfficeTaskInvocation, ref: ArtifactRef): boolean {
  const command = original.task.proof.association.intent.command;
  const id =
    command.command === "create" && command.input.source.kind === "office"
      ? command.input.source.uploadId
      : command.command === "import-into"
        ? command.input.source.id
        : null;
  return (
    ref.kind === "upload" &&
    ref.id === id &&
    original.task.proof.association.originals.some(
      (file) =>
        officeImportOptions(file.mediaType, file.name) !== null &&
        file.digest === ref.digest &&
        file.byteSize === ref.bytes,
    )
  );
}
export async function assertOfficeTaskJobRefs(
  metadata: OfficeMetadata,
  original: OfficeTaskInvocation,
  record: JobRecord,
  acknowledged: OfficeTaskAcknowledged,
): Promise<void> {
  const job = record.job;
  const old = await Effect.runPromise(metadata.job(original.actor.owner, job.binding.jobId));
  if (
    !officeSame(job.input, old?.job.input) &&
    !acknowledged(job.input) &&
    !officeTaskOriginalRef(original, job.input) &&
    !officeTaskStagedRef(original.task.proof, job.input)
  )
    throw officeDenied();
  if (
    job.kind === "execute" &&
    !officeSame(job.code, old?.job.kind === "execute" ? old.job.code : null) &&
    !acknowledged(job.code) &&
    !officeTaskStagedRef(original.task.proof, job.code)
  )
    throw officeDenied();
  if (
    record.state.state === "succeeded" &&
    !officeSame(record.state, old?.state) &&
    !acknowledged(record.state.output)
  )
    throw officeDenied();
}

/** Stored record checks only after real Root registration/live proof. No actor from a DTO. */
export async function assertOfficeTaskRecord(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  original: OfficeTaskInvocation,
  record: OperationRecord,
  acknowledged: OfficeTaskAcknowledged,
): Promise<void> {
  const command = request.command;
  const actor = original.actor;
  if (
    command === null ||
    !("operationId" in command.input) ||
    record.receipt.operationId !== command.input.operationId ||
    !sameOfficeTaskInput(original.task.proof, record) ||
    record.intent.kind === "approve" ||
    record.intent.kind === "merge"
  )
    throw officeDenied();
  const saved = await Effect.runPromise(
    metadata.operation(actor.owner, record.receipt.operationId),
  );
  const artifact = record.receipt.artifact;
  if (
    artifact !== null &&
    !officeSame(artifact, saved?.receipt.artifact) &&
    !acknowledged(artifact)
  ) {
    const job = saved?.jobId
      ? await Effect.runPromise(metadata.job(actor.owner, saved.jobId))
      : null;
    if (
      job === null ||
      job.job.binding.operationId !== record.receipt.operationId ||
      job.state.state !== "succeeded" ||
      !officeSame(job.state.output, artifact)
    )
      throw officeDenied();
  }
  if (command.method === "office.receipt") {
    if (
      saved === null ||
      !officeSame(saved.actor, record.actor) ||
      !officeSame(saved.intent, record.intent)
    )
      throw officeDenied();
    assertOfficeTaskObservedIntent(original.task.proof, saved);
    for (const key of ["source", "input", "code", "proposal"] as const) {
      const ref = record.artifacts[key];
      if (!officeSame(ref, saved.artifacts[key]) && (ref === null || !acknowledged(ref)))
        throw officeDenied();
    }
    return; // Owning CAS/receipt predicates still apply; metadata repair is never native dispatch.
  }
  const proven = original.task.proof.association.intent.command;
  if (
    !officeSame(record.actor, actor) ||
    !("input" in proven) ||
    record.intent.kind !== proven.command ||
    !officeSame(record.intent.input, proven.input)
  )
    throw officeDenied();
  const document = await Effect.runPromise(metadata.document(actor.owner, record.documentId));
  if (
    document === null ||
    !officeSame(document.owner, actor.owner) ||
    document.document.id !== record.documentId ||
    document.unitId !== record.unitId
  )
    throw officeDenied();
  const creation = record.intent.kind === "create" || record.intent.kind === "create-draft";
  if (creation) {
    if (
      record.intent.kind === "create" &&
      (record.intent.input.destination !== "new-draft" ||
        document.originOperationId !== record.receipt.operationId)
    )
      throw officeDenied();
    if (
      record.intent.kind === "create-draft" &&
      (original.task.binding.fork === null ||
        original.task.binding.fork.view.documentId !== record.documentId ||
        original.task.binding.fork.target.unitId !== record.unitId)
    )
      throw officeDenied();
    if (record.receipt.draftId === null) throw officeDenied();
    const draft = await Effect.runPromise(metadata.draft(actor.owner, record.receipt.draftId));
    if (
      draft === null ||
      draft.documentId !== record.documentId ||
      draft.generation !== 1 ||
      draft.originOperationId !== record.receipt.operationId ||
      draft.worktreeId !== record.worktreeId
    )
      throw officeDenied();
  } else if (record.intent.kind === "render" || record.intent.kind === "export") {
    const view = original.task.binding.readView;
    if (
      view === null ||
      view.view.id !== record.intent.input.viewId ||
      view.target.documentId !== record.documentId ||
      view.target.unitId !== record.unitId
    )
      throw officeDenied();
  } else {
    const bound = actor.target;
    if (
      bound === null ||
      bound.documentId !== record.documentId ||
      bound.draftId !== record.receipt.draftId
    )
      throw officeDenied();
    const draft = await Effect.runPromise(metadata.draft(actor.owner, bound.draftId));
    if (
      draft === null ||
      draft.worktreeId !== record.worktreeId ||
      draft.documentId !== record.documentId ||
      (record.intent.kind === "reopen"
        ? draft.generation < bound.generation
        : draft.generation !== bound.generation)
    )
      throw officeDenied();
  }
  for (const key of ["source", "input", "code", "proposal"] as const) {
    const ref = record.artifacts[key];
    if (ref === null || officeSame(ref, saved?.artifacts[key]) || acknowledged(ref)) continue;
    // Accepted originals are content selectors AFTER genuine input/session proof, not digest authentication.
    if (
      officeTaskStagedRef(original.task.proof, ref) ||
      (key === "source" && officeTaskOriginalRef(original, ref))
    )
      continue;
    throw officeDenied();
  }
}
