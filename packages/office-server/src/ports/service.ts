import { Context } from "effect";
import type { Effect } from "effect";
import type {
  Approve,
  ArtifactRef,
  CreateDocument,
  CreateDraft,
  Document,
  DocumentPage,
  Draft,
  DraftPage,
  DraftTransition,
  Editor,
  EditorAction,
  EventPage,
  Execute,
  ImportInto,
  ExportRequest,
  InspectRequest,
  Inspection,
  Merge,
  OfficeError,
  OfficeLimits,
  Receipt,
  RenderRequest,
  ReviewPage,
  Target,
  View,
} from "@starter/office-contract";
import type { Actor, HumanActor, RecoveryActor, VerifyActor } from "./identity.ts";
import type { OfficeBytes, OfficeMetadata } from "./storage.ts";
import type { DocumentAuthority } from "./authority.ts";
import type { IsolatedJobs } from "./jobs.ts";
import type { OpenNative } from "./native.ts";
import type { ObserveNativeReceipt } from "./native-receipts.ts";

export type OfficeResult<A> = Effect.Effect<A, OfficeError>;
export type UploadInput = {
  readonly operationId: string;
  readonly kind: "upload" | "code";
  readonly filename: string;
  readonly declaredBytes: number;
  readonly expectedDigest: string | null;
  readonly body: ReadableStream<Uint8Array>;
};
export type Download = {
  readonly ref: ArtifactRef;
  readonly filename: string;
  readonly body: ReadableStream<Uint8Array>;
};
/** Domain methods capture dependencies, not credentials or a mutable ambient owner. */
export interface OfficeService {
  list(actor: Actor, cursor: string | null): OfficeResult<typeof DocumentPage.Type>;
  drafts(actor: Actor, cursor: string | null): OfficeResult<typeof DraftPage.Type>;
  document(actor: Actor, id: string): OfficeResult<Document>;
  draft(actor: Actor, id: string): OfficeResult<Draft>;
  /** Core rejects task destination main, including direct callers bypassing OfficeCommand. */
  create(actor: Actor, input: CreateDocument): OfficeResult<Receipt>;
  createDraft(actor: Actor, input: CreateDraft): OfficeResult<Receipt>;
  open(actor: Actor, input: Target): OfficeResult<View>;
  editor(actor: HumanActor, input: EditorAction): OfficeResult<Editor>;
  execute(actor: Actor, input: Execute): OfficeResult<Receipt>;
  importInto(actor: Actor, input: ImportInto): OfficeResult<Receipt>;
  inspect(actor: Actor, input: InspectRequest): OfficeResult<Inspection>;
  render(actor: Actor, input: RenderRequest): OfficeResult<Receipt>;
  export(actor: Actor, input: ExportRequest): OfficeResult<Receipt>;
  ready(actor: Actor, input: DraftTransition): OfficeResult<Receipt>;
  review(actor: Actor, reviewId: string, cursor: string | null): OfficeResult<ReviewPage>;
  approve(actor: HumanActor, input: Approve): OfficeResult<Receipt>;
  merge(actor: HumanActor | RecoveryActor, input: Merge): OfficeResult<Receipt>;
  reopen(actor: Actor, input: DraftTransition): OfficeResult<Receipt>;
  discard(actor: Actor, input: DraftTransition): OfficeResult<Receipt>;
  receipt(actor: Actor, operationId: string): OfficeResult<Receipt>;
  cancel(actor: Actor, operationId: string): OfficeResult<Receipt>;
  events(actor: Actor, documentId: string, after: number): OfficeResult<typeof EventPage.Type>;
  upload(actor: Actor, input: UploadInput): OfficeResult<ArtifactRef>;
  artifact(actor: Actor, artifactId: string): OfficeResult<ArtifactRef>;
  download(actor: Actor, artifactId: string): OfficeResult<Download>;
}
export class Office extends Context.Service<Office, OfficeService>()("office/Office") {}
/** Caller owns injected resources; core owns services/guards/materializers it constructs. */
export interface OfficeDependencies {
  readonly native: OpenNative;
  readonly observeNativeReceipt: ObserveNativeReceipt;
  readonly metadata: OfficeMetadata;
  readonly bytes: OfficeBytes;
  readonly authority: DocumentAuthority;
  readonly jobs: IsolatedJobs;
  readonly verifyActor: VerifyActor;
  readonly policy: {
    readonly version: string;
    readonly sdkVersion: "1.0.3";
    readonly imageDigest: string;
    readonly limits: OfficeLimits;
  };
}
