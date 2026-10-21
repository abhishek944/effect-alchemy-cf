import { Schema } from "effect";
import {
  ArtifactRef,
  Count,
  Digest,
  DraftTarget,
  ExportOptions,
  Failure,
  Id,
  ImportOptions,
  InspectQuery,
  Kind,
  RenderSelection,
  Revision,
} from "@starter/office-contract";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import { OwnerClaims } from "@starter/office-server/ports";
import { NativeId } from "../schemas.ts";

export const JobBindingRow = Schema.Struct({
  version: Schema.Literal(1),
  jobId: Id,
  operationId: Id,
  ownerDigest: Digest,
  documentId: Id,
  unitId: NativeId,
  kind: Kind,
  generation: Schema.NullOr(Count),
  baseRevision: Schema.NullOr(Revision),
  inputDigest: Digest,
  codeDigest: Schema.NullOr(Digest),
  policyVersion: NativeId,
  imageDigest: Schema.String.check(Schema.isPattern(/^sha256:[a-f0-9]{64}$/)),
  codec: Schema.Literal(NATIVE_WIRE_CODEC),
});
const ExecutionBinding = Schema.Struct({
  ...JobBindingRow.fields,
  generation: Count,
  baseRevision: Revision,
  codeDigest: Digest,
});
export const IsolatedJobRow = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("execute"),
    binding: ExecutionBinding,
    input: ArtifactRef,
    target: DraftTarget,
    code: ArtifactRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("import"),
    binding: JobBindingRow,
    input: ArtifactRef,
    options: ImportOptions,
    filename: NativeId,
  }),
  Schema.Struct({
    kind: Schema.Literal("export"),
    binding: JobBindingRow,
    input: ArtifactRef,
    options: ExportOptions,
  }),
  Schema.Struct({
    kind: Schema.Literal("render"),
    binding: JobBindingRow,
    input: ArtifactRef,
    selection: RenderSelection,
  }),
  Schema.Struct({
    kind: Schema.Literal("inspect"),
    binding: JobBindingRow,
    input: ArtifactRef,
    viewId: Id,
    query: InspectQuery,
  }),
]);
export const JobStateRow = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["queued", "running"]), jobId: Id }),
  Schema.Struct({
    state: Schema.Literal("succeeded"),
    jobId: Id,
    inputDigest: Digest,
    output: ArtifactRef,
  }),
  Schema.Struct({
    state: Schema.Literals(["failed", "execution-unknown"]),
    jobId: Id,
    error: Failure,
  }),
]);
export const JobRow = Schema.Struct({
  owner: OwnerClaims,
  job: IsolatedJobRow,
  state: JobStateRow,
  version: Count,
  dispatch: Schema.NullOr(
    Schema.Struct({ workerId: NativeId, claimedAt: Count, deadlineAt: Count }),
  ),
  createdAt: Count,
  updatedAt: Count,
});
export const jobSchemaStatements = [
  `CREATE TABLE IF NOT EXISTS office_meta_jobs (owner TEXT NOT NULL,id TEXT NOT NULL,document TEXT NOT NULL,
    operation TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,record TEXT NOT NULL,binding TEXT NOT NULL,
    PRIMARY KEY(owner,id),UNIQUE(owner,operation))`,
  "CREATE INDEX IF NOT EXISTS office_meta_job_active ON office_meta_jobs(owner,document,state)",
] as const;
