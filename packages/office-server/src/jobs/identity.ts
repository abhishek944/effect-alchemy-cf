import {
  decodeWireSync,
  OfficeConflict,
  OfficeInvalid,
  safeFailure,
} from "@starter/office-contract";
import type { IsolatedJob, JobRecord, JobState, OwnerScope } from "../ports/index.ts";
import { artifactKey } from "./artifacts.ts";
import { bindingKey, ownerDigest } from "./frames.ts";
import { IsolatedJobSchema } from "./schemas.ts";

export const unknownJobState = (job: IsolatedJob): JobState => ({
  state: "execution-unknown",
  jobId: job.binding.jobId,
  error: safeFailure("OUTCOME_UNKNOWN", job.binding.operationId),
});
export const jobScopeKey = (owner: OwnerScope, id: string): string =>
  JSON.stringify([owner.stage, owner.ownerId, id]);
export function jobIdentity(input: IsolatedJob): string {
  const job = decodeWireSync(IsolatedJobSchema)(input);
  const base = [job.kind, bindingKey(job.binding), artifactKey(job.input)];
  switch (job.kind) {
    case "execute":
      return JSON.stringify([
        ...base,
        artifactKey(job.code),
        job.target.documentId,
        job.target.draftId,
        job.target.generation,
        job.target.expectedRevision,
      ]);
    case "import":
      return JSON.stringify([
        ...base,
        job.filename,
        Object.entries(job.options).toSorted(([a], [b]) => a.localeCompare(b)),
      ]);
    case "export":
      return JSON.stringify([
        ...base,
        Object.entries(job.options).toSorted(([a], [b]) => a.localeCompare(b)),
      ]);
    case "render":
      return JSON.stringify([
        ...base,
        Object.entries(job.selection).toSorted(([a], [b]) => a.localeCompare(b)),
      ]);
    case "inspect":
      return JSON.stringify([
        ...base,
        job.viewId,
        Object.entries(job.query).toSorted(([a], [b]) => a.localeCompare(b)),
      ]);
  }
  throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
}
export function requireJobIdentity(
  owner: OwnerScope,
  job: IsolatedJob,
  imageDigest: string,
  policyVersion: string,
): void {
  const b = job.binding;
  if (
    b.ownerDigest !== ownerDigest(owner) ||
    b.imageDigest !== imageDigest ||
    b.policyVersion !== policyVersion ||
    (job.kind === "execute"
      ? job.code.digest !== b.codeDigest ||
        job.code.kind !== "code" ||
        job.target.documentId !== b.documentId ||
        job.target.generation !== b.generation ||
        job.target.expectedRevision !== b.baseRevision
      : b.codeDigest !== null) ||
    (job.kind === "import"
      ? job.input.kind !== "upload" || b.inputDigest !== job.input.digest
      : job.input.kind !== "native-input")
  )
    throw new OfficeInvalid(safeFailure("INVALID_INPUT", b.operationId));
}
export function requireJobRecord(
  owner: OwnerScope,
  record: JobRecord,
  expected?: IsolatedJob,
): void {
  if (
    record.owner.stage !== owner.stage ||
    record.owner.ownerId !== owner.ownerId ||
    record.job.binding.ownerDigest !== ownerDigest(owner) ||
    (record.state.state === "succeeded" &&
      record.state.inputDigest !== record.job.binding.inputDigest) ||
    record.state.jobId !== record.job.binding.jobId ||
    (expected !== undefined && jobIdentity(record.job) !== jobIdentity(expected))
  )
    throw new OfficeConflict(safeFailure("IDEMPOTENCY_CONFLICT"));
}
