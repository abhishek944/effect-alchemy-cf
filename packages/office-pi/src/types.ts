import type { Effect } from "effect";
import type { ArtifactRef, OfficeCommand, OfficeError } from "@starter/office-contract";
import type { BinaryUpload, OfficeClient } from "@starter/office-contract/client";
import type { ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";

export type OfficeToolContext = Parameters<ToolRegistration["execute"]>[2];
export type OfficeTaskClient = Pick<
  OfficeClient["office"],
  | "list"
  | "draft"
  | "drafts"
  | "open"
  | "create"
  | "createDraft"
  | "execute"
  | "importInto"
  | "inspect"
  | "render"
  | "export"
  | "ready"
  | "review"
  | "reopen"
  | "discard"
  | "receipt"
>;
/** Private host-proven source from this executing input's accepted immutable attachments. */
export type AcceptedOfficeFile = {
  readonly filename: string;
  readonly bytes: number;
  readonly digest: string;
  readonly body: ReadableStream<Uint8Array>;
};
export type OfficeTaskAccess = {
  /** Captures the verified private actor; host bounds HTTP response bytes before parsing. */
  readonly client: OfficeTaskClient;
  readonly upload: (input: BinaryUpload) => Effect.Effect<ArtifactRef, OfficeError>;
  readonly acceptedFile: (fileRef: string) => Effect.Effect<AcceptedOfficeFile, OfficeError>;
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
