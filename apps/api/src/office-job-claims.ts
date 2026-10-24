import { Effect } from "effect";
import { reportEvent, withDiagnostic } from "@starter/diagnostics";
import type { OfficeJobExit } from "./office-job-process.ts";
import type { JobRecord, OfficeMetadata } from "@starter/office-server/ports";
import type { OfficeMetadataCall, OfficeMetadataResponse } from "./office-metadata-dispatch.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officePrivateDigest } from "./office-private-placement.ts";
import { repairOfficeJobClaim } from "./office-job-claim-repair.ts";

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
      throw withDiagnostic(officeDenied(), "job-binding-association");
    if (job.kind === "inspect") {
      if (command.method !== "office.inspect" || command.input.viewId !== job.viewId)
        throw withDiagnostic(officeDenied(), "job-inspect-command");
      const view = await Effect.runPromise(metadata.view(record.owner, job.viewId));
      if (
        view === null ||
        view.view.expiresAt <= Date.now() ||
        view.target.documentId !== job.binding.documentId ||
        view.target.unitId !== job.binding.unitId
      )
        throw withDiagnostic(officeDenied(), "job-inspect-view");
    } else if (
      !("operationId" in command.input) ||
      command.input.operationId !== job.binding.operationId
    )
      throw withDiagnostic(officeDenied(), "job-operation-association");
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
        await repairOfficeJobClaim(
          metadata,
          request,
          record,
          call.input.expectedVersion,
          () => started,
          () => acknowledged !== null,
        );
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
          throw withDiagnostic(officeDenied(), "job-claim-dispatch-invalid");
        reportEvent({
          component: "office.job-claims",
          operation: "claim",
          phase: "claim-validation",
          jobId: id,
          operationId: record.job.binding.operationId,
          outcome: "not-submitted",
        });
        attempted.add(id); // A lost CAS ACK is UNKNOWN. No second attempt or running-row grant lookup.
        const existing = await Effect.runPromise(metadata.job(record.owner, id));
        if (
          existing === null ||
          existing.version !== 0 ||
          existing.state.state !== "queued" ||
          !officeSame(existing.job, record.job)
        )
          throw withDiagnostic(officeDenied(), "job-original-queued-mismatch");
      } else {
        if (
          !attempted.has(id) ||
          (acknowledged === null && record.state.state !== "execution-unknown") ||
          (acknowledged !== null && !officeSame(acknowledged.job, record.job))
        )
          throw withDiagnostic(officeDenied(), "job-terminal-association");
        if (
          record.state.state === "succeeded" &&
          (physical === null || physical.status !== "exited" || physical.exitCode !== 0)
        )
          throw withDiagnostic(officeDenied(), "job-success-unconfirmed");
        if (record.state.state === "failed" && started && physical === null)
          throw withDiagnostic(officeDenied(), "job-failure-cleanup-unconfirmed");
        terminalRequested = true; // Revokes start BEFORE terminal publication/physical teardown.
      }
    },
    after(response: OfficeMetadataResponse) {
      if (response.method !== "metadata.advanceJob" || !("value" in response)) return;
      const record = response.value;
      if (record.state.state !== "running") return;
      if (!attempted.has(record.job.binding.jobId) || acknowledged !== null)
        throw withDiagnostic(officeDenied(), "job-claim-ack-association");
      acknowledged = record; // Only THIS actual provider result authorizes the single fresh placement.
      reportEvent({
        component: "office.job-claims",
        operation: "claim",
        phase: "claim-ack",
        jobId: record.job.binding.jobId,
        operationId: record.job.binding.operationId,
        outcome: "confirmed",
      });
    },
    take(): JobRecord {
      if (
        acknowledged === null ||
        started ||
        terminalRequested ||
        acknowledged.dispatch === null ||
        acknowledged.dispatch.deadlineAt <= Date.now()
      )
        throw withDiagnostic(officeDenied(), "job-claim-not-dispatchable");
      started = true;
      return acknowledged;
    },
    // Called ONLY by the real known-box private status/body join, never a Node JSON command.
    confirmCleanup(actual: OfficeJobExit) {
      physical = actual;
      reportEvent({
        component: "office.job-claims",
        operation: "cleanup",
        phase: "physical-confirmed",
        jobId: acknowledged?.job.binding.jobId,
        operationId: acknowledged?.job.binding.operationId,
        outcome: "confirmed",
        reason: actual.status,
        exitCode: actual.exitCode ?? undefined,
      });
    },
    get hasStarted() {
      return started;
    },
  };
}
export type OfficeJobClaims = ReturnType<typeof officeJobClaims>;
