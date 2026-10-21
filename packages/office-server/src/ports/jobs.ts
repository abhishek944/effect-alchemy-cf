import type { Effect } from "effect";
import type { NATIVE_WIRE_CODEC } from "@starter/office-contract/native-wire";
import type { IChangeset, IMutation } from "@univerjs/protocol";
import type { ISnapshotWithBlocks } from "@univerjs-pro/collaboration-service";
import type { OwnerScope } from "./identity.ts";
import type {
  ArtifactRef,
  DraftTarget,
  ExportOptions,
  Failure,
  ImportOptions,
  InspectQuery,
  Kind,
  OfficeError,
  RenderSelection,
} from "@starter/office-contract";

export type JobBinding = {
  readonly version: 1;
  readonly jobId: string;
  readonly operationId: string;
  /** SHA256 of UTF-8 JSON.stringify([owner.stage, owner.ownerId]); not authority. */
  readonly ownerDigest: string;
  readonly documentId: string;
  readonly unitId: string;
  readonly kind: Kind;
  readonly generation: number | null;
  readonly baseRevision: number | null;
  /** Import: raw upload SHA256. Other jobs: standalone native snapshot wire SHA256. */
  readonly inputDigest: string;
  readonly codeDigest: string | null;
  readonly policyVersion: string;
  readonly imageDigest: string;
  readonly codec: typeof NATIVE_WIRE_CODEC;
};
export type ProposalBinding = JobBinding & {
  readonly generation: number;
  readonly baseRevision: number;
};
export type ExecutionBinding = ProposalBinding & { readonly codeDigest: string };
export type IsolatedJob = {
  readonly binding: JobBinding;
  readonly input: ArtifactRef;
} & (
  | {
      readonly kind: "execute";
      readonly binding: ExecutionBinding;
      readonly target: DraftTarget;
      readonly code: ArtifactRef;
    }
  | { readonly kind: "import"; readonly options: ImportOptions; readonly filename: string }
  | { readonly kind: "export"; readonly options: ExportOptions }
  | { readonly kind: "render"; readonly selection: RenderSelection }
  | {
      readonly kind: "inspect";
      /** Real read authority; operationId is read correlation, not a native write admission. */
      readonly viewId: string;
      readonly query: InspectQuery;
    }
);
export type JobState =
  | { readonly state: "queued" | "running"; readonly jobId: string }
  | {
      readonly state: "succeeded";
      readonly jobId: string;
      readonly inputDigest: string;
      readonly output: ArtifactRef;
    }
  | {
      readonly state: "failed" | "execution-unknown";
      readonly jobId: string;
      readonly error: Failure;
    };
export interface IsolatedJobs {
  /** Durable claim-before-dispatch; uncertainty/restart never permits source replay. */
  submit(owner: OwnerScope, job: IsolatedJob): Effect.Effect<JobState, OfficeError>;
  status(owner: OwnerScope, jobId: string): Effect.Effect<JobState, OfficeError>;
  cancel(owner: OwnerScope, jobId: string): Effect.Effect<JobState, OfficeError>;
}
/** These three frames are NATIVE ARTIFACT CONTENT, never operation/receipt/model metadata. */
export type NativeInputFrame = {
  readonly binding: JobBinding;
  readonly native: ISnapshotWithBlocks;
};
export type MutationCandidateFrame = {
  readonly binding: ExecutionBinding;
  readonly mutations: readonly IMutation[];
};
export type NativeProposalFrame = {
  readonly binding: ProposalBinding;
  readonly changeset: IChangeset;
};
