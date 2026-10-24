import { Effect } from "effect";
import { withDiagnostic } from "@starter/diagnostics";
import { safeFailure } from "@starter/office-contract";
import type { JobRecord, OfficeMetadata } from "@starter/office-server/ports";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officeJobControlUnit } from "./office-job-repair.ts";
import { sameOfficeTaskInput } from "./office-task-lineage.ts";

/** Control-only repair checks: never creates an original claim ACK or dispatch authority. */
export async function repairOfficeJobClaim(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  record: JobRecord,
  expected: number,
  hasStarted: () => boolean,
  hasAcknowledged: () => boolean,
): Promise<void> {
  const command = request.command;
  if (command?.method !== "office.receipt" && command?.method !== "office.cancel")
    throw withDiagnostic(officeDenied(), "job-repair-command");
  await request.live();
  if (
    record.job.kind === "inspect" ||
    hasStarted() ||
    hasAcknowledged() ||
    !officeSame(record.owner, request.original.actor.owner) ||
    record.job.binding.operationId !== command.input.operationId
  )
    throw withDiagnostic(officeDenied(), "job-repair-association");
  const id = record.job.binding.jobId;
  const old = await Effect.runPromise(metadata.job(record.owner, id));
  const operation = await Effect.runPromise(
    metadata.operation(record.owner, command.input.operationId),
  );
  if (
    old === null ||
    operation === null ||
    expected !== old.version ||
    record.version !== old.version + 1 ||
    record.createdAt !== old.createdAt ||
    !officeSame(old.job, record.job) ||
    !officeSame(old.dispatch, record.dispatch) ||
    operation.jobId !== id ||
    ("task" in request.original
      ? !sameOfficeTaskInput(request.original.task.proof, operation)
      : operation.actor.capability !== "human") ||
    operation.actor.principalId !== request.original.actor.principalId ||
    operation.documentId !== record.job.binding.documentId ||
    !(await officeJobControlUnit(operation, record.job)) ||
    operation.policyVersion !== record.job.binding.policyVersion
  )
    throw withDiagnostic(officeDenied(), "job-repair-lineage");
  if (old.state.state === "running") {
    if (
      old.dispatch === null ||
      old.dispatch.deadlineAt > Date.now() ||
      record.updatedAt < old.dispatch.deadlineAt ||
      record.state.state !== "execution-unknown" ||
      !officeSame(record.state.error, safeFailure("OUTCOME_UNKNOWN", command.input.operationId))
    )
      throw withDiagnostic(officeDenied(), "job-repair-running-fence");
  } else if (
    old.state.state !== "queued" ||
    old.dispatch !== null ||
    command.method !== "office.cancel" ||
    operation.receipt.phase !== "cancelled-before-dispatch" ||
    record.state.state !== "failed" ||
    !officeSame(record.state.error, safeFailure("INVALID_INPUT", command.input.operationId))
  )
    throw withDiagnostic(officeDenied(), "job-repair-cancel-fence");
  await request.live();
}
