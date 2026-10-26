import { OfficeLimited, safeFailure } from "@starter/office-contract";
import type { ArtifactRef } from "@starter/office-contract";
import type { IsolatedJob, JobRecord } from "@starter/office-server/ports";
import type { MetadataStore } from "../store.ts";
import { canonical, conflict, invalid } from "../store.ts";

export const terminal = (record: JobRecord): boolean =>
  !["queued", "running"].includes(record.state.state);
export function jobRefs(record: JobRecord): readonly ArtifactRef[] {
  return [
    record.job.input,
    ...(record.job.kind === "execute" ? [record.job.code] : []),
    ...(record.state.state === "succeeded" ? [record.state.output] : []),
  ];
}
export async function validateJob(db: MetadataStore, record: JobRecord): Promise<void> {
  const { job, state, dispatch } = record,
    b = job.binding;
  db.owner(record.owner);
  if (
    b.ownerDigest !== (await db.hash([record.owner.stage, record.owner.ownerId])) ||
    state.jobId !== b.jobId ||
    record.updatedAt < record.createdAt ||
    (b.generation !== null && b.generation < 1)
  )
    throw invalid();
  if (job.kind === "import") {
    if (
      job.input.kind !== "upload" ||
      job.input.digest !== b.inputDigest ||
      b.baseRevision !== null ||
      b.codeDigest !== null ||
      job.options.kind !== b.kind
    )
      throw invalid();
  } else if (job.input.kind !== "native-input" || b.baseRevision === null) throw invalid();
  if (job.kind === "execute") {
    if (
      job.code.kind !== "code" ||
      job.code.digest !== b.codeDigest ||
      job.target.documentId !== b.documentId ||
      job.target.generation !== b.generation ||
      job.target.expectedRevision !== b.baseRevision ||
      b.generation === null
    )
      throw invalid();
  } else if (b.codeDigest !== null) throw invalid();
  if (job.kind === "export" && job.options.kind !== b.kind) throw invalid();
  if (job.kind === "render" && job.selection.kind !== b.kind) throw invalid();
  if (job.kind === "inspect") {
    const kind = ["workbook", "worksheet", "range"].includes(job.query.kind)
      ? "sheet"
      : ["document", "paragraphs"].includes(job.query.kind)
        ? "doc"
        : "slide";
    if (b.kind !== kind) throw invalid();
  }
  if (state.state === "queued" && (record.version !== 0 || dispatch !== null)) throw invalid();
  if (state.state === "running" && (record.version !== 1 || dispatch === null)) throw invalid();
  if (
    dispatch &&
    (dispatch.claimedAt < record.createdAt ||
      dispatch.deadlineAt <= dispatch.claimedAt ||
      dispatch.deadlineAt - dispatch.claimedAt > db.limits.jobSeconds * 1000 ||
      dispatch.claimedAt > record.updatedAt)
  )
    throw invalid();
  if (terminal(record) && record.version < 1) throw invalid();
  if (state.state === "succeeded") {
    const kinds: Readonly<Record<IsolatedJob["kind"], ArtifactRef["kind"]>> = {
      execute: "native-proposal",
      import: "native-input",
      export: "export",
      render: "render",
      inspect: "inspection",
    };
    if (!dispatch || state.inputDigest !== b.inputDigest || state.output.kind !== kinds[job.kind])
      throw invalid();
  }
  if (state.state === "failed" || state.state === "execution-unknown") {
    if (
      state.error.operationId !== b.operationId ||
      (state.state === "execution-unknown"
        ? dispatch === null || state.error.code !== "OUTCOME_UNKNOWN"
        : state.error.code === "OUTCOME_UNKNOWN")
    )
      throw invalid();
  }
  for (const ref of jobRefs(record)) {
    const max =
      ref.kind === "upload"
        ? db.limits.uploadBytes
        : ref.kind === "code"
          ? db.limits.codeBytes
          : ref.kind === "native-proposal"
            ? db.limits.proposalBytes
            : ref.kind === "render"
              ? db.limits.renderBytes
              : ref.kind === "inspection"
                ? db.limits.responseBytes
                : db.limits.nativeBytes;
    if (ref.bytes > max) throw new OfficeLimited(safeFailure("LIMIT_EXCEEDED"));
  }
}
export function validateAdvance(previous: JobRecord, next: JobRecord, expected: number): void {
  if (
    canonical(previous.owner) !== canonical(next.owner) ||
    canonical(previous.job) !== canonical(next.job) ||
    previous.createdAt !== next.createdAt
  )
    throw conflict();
  if (
    previous.version !== expected ||
    next.version !== expected + 1 ||
    next.updatedAt < previous.updatedAt ||
    terminal(previous)
  )
    throw conflict("NOT_EDITABLE");
  if (previous.state.state === "queued") {
    if (next.state.state === "running") {
      if (!next.dispatch || next.dispatch.claimedAt !== next.updatedAt) throw invalid();
    } else if (next.state.state !== "failed" || next.dispatch !== null)
      throw conflict("NOT_EDITABLE");
  } else if (!terminal(next) || canonical(next.dispatch) !== canonical(previous.dispatch))
    throw conflict("NOT_EDITABLE");
}
