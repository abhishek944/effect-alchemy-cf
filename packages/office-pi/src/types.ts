import type { Effect } from "effect";
import type { OfficeStagingFailure } from "./staging-failure.ts";
import type {
  ArtifactRef,
  CreateDocument,
  CreateDraft,
  Cursor,
  DraftTarget,
  DraftTransition,
  Execute,
  ExportRequest,
  Id,
  ImportInto,
  InspectRequest,
  OfficeCommand,
  OfficeError,
  Receipt,
  RenderRequest,
  Target,
} from "@starter/office-contract";
import type { BinaryUpload } from "@starter/office-contract/client";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";

export type OfficeToolContext = Parameters<ToolRegistration["execute"]>[2];
/**
 * Finite private Office command port. The host owns real transport, intent correlation and
 * bounded decoding; callers pass typed command inputs, never a synthesized HTTP request.
 */
export type OfficeTaskPort = {
  readonly list: (input: { readonly cursor: typeof Cursor.Type }) => Promise<unknown>;
  readonly drafts: (input: { readonly cursor: typeof Cursor.Type }) => Promise<unknown>;
  readonly draft: (input: { readonly id: typeof Id.Type }) => Promise<unknown>;
  readonly open: (input: Target) => Promise<unknown>;
  readonly create: (input: CreateDocument) => Promise<unknown>;
  readonly createDraft: (input: CreateDraft) => Promise<unknown>;
  readonly execute: (input: Execute) => Promise<unknown>;
  readonly importInto: (input: ImportInto) => Promise<unknown>;
  readonly inspect: (input: InspectRequest) => Promise<unknown>;
  readonly render: (input: RenderRequest) => Promise<unknown>;
  readonly export: (input: ExportRequest) => Promise<unknown>;
  readonly ready: (input: DraftTransition) => Promise<unknown>;
  readonly review: (input: {
    readonly reviewId: typeof Id.Type;
    readonly cursor: typeof Cursor.Type;
  }) => Promise<unknown>;
  readonly reopen: (input: DraftTransition) => Promise<unknown>;
  readonly discard: (input: DraftTransition) => Promise<unknown>;
  readonly receipt: (input: { readonly operationId: typeof Id.Type }) => Promise<unknown>;
};
/** Private host-proven source from this executing input's accepted immutable attachments. */
export type AcceptedOfficeFile = {
  readonly filename: string;
  readonly bytes: number;
  readonly digest: string;
  readonly body: ReadableStream<Uint8Array>;
};
export type OfficeAttachment = {
  readonly id: string;
  readonly name: string;
  readonly mediaType: string;
};
export type OfficeTaskAccess = {
  readonly attachment?: OfficeAttachment;
  readonly attachmentReceipt?: Receipt | null;
  /** Captures the verified private actor; host bounds HTTP response bytes before parsing. */
  readonly client: OfficeTaskPort;
  readonly upload: (
    input: BinaryUpload,
  ) => Effect.Effect<ArtifactRef, OfficeError | OfficeStagingFailure>;
  readonly acceptedFile: (
    fileRef: string,
  ) => Effect.Effect<AcceptedOfficeFile, OfficeError | OfficeStagingFailure>;
  /** Exact host-proven stage selector; null is unknown, never permission to upload again. */
  readonly observeStaged?: () => Promise<ArtifactRef | null>;
};
/** Source is deliberately excluded from authority/journal metadata. */
export type OfficeIntentCommand =
  | Exclude<OfficeCommand, { readonly command: "stage-code" }>
  | {
      readonly command: "stage-code";
      readonly input: {
        readonly operationId: string;
        readonly digest: string;
        readonly bytes: number;
      };
    };
export type OfficeToolIntent = {
  /** Private invocation ID; receipt reads select command.operationId, not this new ID. */
  readonly operationId: string;
  readonly digest: string;
  readonly command: OfficeIntentCommand;
  /** Private server-derived workflow step; never accepted as model authority. */
  readonly attachmentId?: string;
  readonly step?: string;
  readonly basis?: DraftTarget;
};
export type OfficeResolution = {
  readonly api: ToolExecutionApi;
  readonly context: OfficeToolContext;
  readonly intent: OfficeToolIntent;
};
export type OfficePiHost = {
  /**
   * Prove this tool's accepted native input, private principal and exact command/target.
   * Revalidate on every call; no latest-transcript/current-pane or task-ID-only fallback.
   * Returned capabilities must capture real host authority, not client-supplied claims.
   */
  readonly resolve: (input: OfficeResolution) => Promise<OfficeTaskAccess>;
};
