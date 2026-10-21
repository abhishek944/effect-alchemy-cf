import { Schema } from "effect";
import {
  ArtifactRef,
  Count,
  Digest,
  DraftTarget,
  ExportOptions,
  Id,
  ImportOptions,
  InspectQuery,
  Kind,
  RenderSelection,
  Revision,
} from "@starter/office-contract";
import { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";

const NativeId = Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256));
export const JobBindingSchema = Schema.Struct({
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
export const ProposalBindingSchema = Schema.Struct({
  ...JobBindingSchema.fields,
  generation: Count.check(Schema.isGreaterThanOrEqualTo(1)),
  baseRevision: Revision,
});
export const ExecutionBindingSchema = Schema.Struct({
  ...ProposalBindingSchema.fields,
  codeDigest: Digest,
});
export const IsolatedJobSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("execute"),
    binding: ExecutionBindingSchema,
    input: ArtifactRef,
    target: DraftTarget,
    code: ArtifactRef,
  }),
  Schema.Struct({
    kind: Schema.Literal("import"),
    binding: JobBindingSchema,
    input: ArtifactRef,
    options: ImportOptions,
    filename: NativeId,
  }),
  Schema.Struct({
    kind: Schema.Literal("export"),
    binding: JobBindingSchema,
    input: ArtifactRef,
    options: ExportOptions,
  }),
  Schema.Struct({
    kind: Schema.Literal("render"),
    binding: JobBindingSchema,
    input: ArtifactRef,
    selection: RenderSelection,
  }),
  Schema.Struct({
    kind: Schema.Literal("inspect"),
    binding: JobBindingSchema,
    input: ArtifactRef,
    viewId: Id,
    query: InspectQuery,
  }),
]);
export const MutationSchema = Schema.Struct({
  id: NativeId,
  data: Schema.String.check(Schema.isMaxLength(2 * 1024 * 1024)),
});
export const MutationCandidateSchema = Schema.Struct({
  binding: ExecutionBindingSchema,
  mutations: Schema.Array(MutationSchema).check(Schema.isMaxLength(5000)),
});
