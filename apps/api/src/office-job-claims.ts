import { Effect } from "effect";
import { safeFailure } from "@starter/office-contract";
import type { OfficeJobExit } from "./office-job-process.ts";
import type { JobRecord, OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeMetadataCall, OfficeMetadataResponse } from "./office-metadata-dispatch.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officePrivateDigest } from "./office-private-placement.ts";
import { officeJobControlUnit } from "./office-job-repair.ts";
import { sameOfficeTaskInput } from "./office-task-lineage.ts";

/** Tracks the actual original CAS result, never a job-id/constructor/queried-running substitute. */
export function officeJobClaims(
  metadata: OfficeMetadata,
  request: OfficePrivateRequest,
  cohort: { readonly nodeId: string; readonly imageDigest: string; readonly policyVersion: string },
) {
  const attempted = new Set<string>();
  let acknowledged: JobRecord | null = null;
  let started = false,
    terminalRequested = false;
  let physical: OfficeJobExit | null = null;
  async function validate(record: JobRecord) {
    await request.live();
    const { job } = record;
    const command = request.command;
    if (
      !officeSame(record.owner, request.original.actor.owner) ||
      command === null ||
      job.binding.imageDigest !== cohort.imageDigest ||
      job.binding.policyVersion !== cohort.policyVersion ||
      job.binding.ownerDigest !==
        (await officePrivateDigest([record.owner.stage, record.owner.ownerId]))
    )
      throw officeDenied();
    if (job.kind === "inspect") {
      if (command.method !== "office.inspect" || command.input.viewId !== job.viewId)
        throw officeDenied();
      const view = await Effect.runPromise(metadata.view(record.owner, job.viewId));
      if (
        view === null ||
        view.view.expiresAt <= Date.now() ||
        view.target.documentId !== job.binding.documentId ||
        view.target.unitId !== job.binding.unitId
      )
        throw officeDenied();
    } else if (
      !("operationId" in command.input) ||
      command.input.operationId !== job.binding.operationId
    )
      throw officeDenied();
  }
  async function repair(record: JobRecord, expected: number): Promise<void> {
    const command = request.command;
    if (command?.method !== "office.receipt" && command?.method !== "office.cancel")
      throw officeDenied();
    await request.live();
    if (
      record.job.kind === "inspect" ||
      started ||
      acknowledged !== null ||
      !officeSame(record.owner, request.original.actor.owner) ||
      record.job.binding.operationId !== command.input.operationId
    )
      throw officeDenied();
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
      throw officeDenied();
    if (old.state.state === "running") {
      if (
        old.dispatch === null ||
        old.dispatch.deadlineAt > Date.now() ||
        record.updatedAt < old.dispatch.deadlineAt ||
        record.state.state !== "execution-unknown" ||
        !officeSame(record.state.error, safeFailure("OUTCOME_UNKNOWN", command.input.operationId))
      )
        throw officeDenied();
    } else if (
      old.state.state !== "queued" ||
      old.dispatch !== null ||
      command.method !== "office.cancel" ||
      operation.receipt.phase !== "cancelled-before-dispatch" ||
      record.state.state !== "failed" ||
      !officeSame(record.state.error, safeFailure("INVALID_INPUT", command.input.operationId))
    )
      throw officeDenied();
    await request.live();
  }
  return {
    async before(call: OfficeMetadataCall) {
      if (call.method !== "metadata.reserveJob" && call.method !== "metadata.advanceJob") return;
      const { record } = call.input;
      if (
        call.method === "metadata.advanceJob" &&
        (request.command?.method === "office.receipt" ||
          request.command?.method === "office.cancel")
      ) {
        await repair(record, call.input.expectedVersion);
        terminalRequested = true; // Control only: never acknowledged or take authority.
        return;
      }
      await validate(record);
      if (call.method === "metadata.reserveJob") return;
      const id = record.job.binding.jobId;
      if (record.state.state === "running") {
        if (
          call.input.expectedVersion !== 0 ||
          record.version !== 1 ||
          record.dispatch === null ||
          record.dispatch.workerId !== cohort.nodeId ||
          record.dispatch.deadlineAt <= Date.now() ||
          record.dispatch.deadlineAt > request.original.deadline ||
          attempted.has(id)
        )
          throw officeDenied();
        attempted.add(id); // A lost CAS ACK is UNKNOWN. No second attempt or running-row grant lookup.
        const existing = await Effect.runPromise(metadata.job(record.owner, id));
        if (
          existing === null ||
          existing.version !== 0 ||
          existing.state.state !== "queued" ||
          !officeSame(existing.job, record.job)
        )
          throw officeDenied();
      } else {
        if (
          !attempted.has(id) ||
          (acknowledged === null && record.state.state !== "execution-unknown") ||
          (acknowledged !== null && !officeSame(acknowledged.job, record.job))
        )
          throw officeDenied();
        if (
          record.state.state === "succeeded" &&
          (physical === null || physical.status !== "exited" || physical.exitCode !== 0)
        )
          throw officeDenied();
        if (record.state.state === "failed" && started && physical === null) throw officeDenied();
        terminalRequested = true; // Revokes start BEFORE terminal publication/physical teardown.
      }
    },
    after(response: OfficeMetadataResponse) {
      if (response.method !== "metadata.advanceJob" || !("value" in response)) return;
      const record = response.value;
      if (record.state.state !== "running") return;
      if (!attempted.has(record.job.binding.jobId) || acknowledged !== null) throw officeDenied();
      acknowledged = record; // Only THIS actual provider result can authorize the single fresh placement.
    },
    take(): JobRecord {
      if (
        acknowledged === null ||
        started ||
        terminalRequested ||
        acknowledged.dispatch === null ||
        acknowledged.dispatch.deadlineAt <= Date.now()
      )
        throw officeDenied();
      started = true;
      return acknowledged;
    },
    // Called ONLY by the real known-box private status/body join, never a Node JSON command.
    confirmCleanup(actual: OfficeJobExit) {
      physical = actual;
    },
    get hasStarted() {
      return started;
    },
  };
}
export type OfficeJobClaims = ReturnType<typeof officeJobClaims>;
