import type { Message } from "@earendil-works/pi-ai";
import type {
  ConversationId,
  EntryId,
  Extension,
  Harness,
  Storage,
  SubmissionId,
  TaskId,
} from "@earendil-works/pi-durable";
import type { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { ChatImageLegacyEra } from "./chat-image-legacy-era.ts";
import type { ImageBoundInput, ImageOriginalBinding } from "./chat-image-response-schema.ts";

export type ImageNativeContext = Parameters<Storage["task"]>[1];

/** Host dependencies, never model-supplied identity or PiHarness.pi(). */
export type ImageNativeAccess = {
  readonly storage: Storage;
  readonly responses: ChatImageResponseStore;
  readonly ownerId: string;
  readonly chatId: string;
  readonly chatScope: string;
  readonly conversationId: ConversationId;
  readonly owner: () => string | null;
  /**
   * False until all accepted unbound candidates are reconstructed in native entry
   * order, then both Skills/image recovery finish. Current-only bind is insufficient.
   */
  readonly ready: () => boolean;
};

export type ImageRequestAccess = ImageNativeAccess & {
  /** Optional only for compatibility: absence denies all missing-candidate continuations. */
  readonly legacyEra?: ChatImageLegacyEra;
  readonly rawHarness: () => Harness;
};

export type InputOccurrence = {
  readonly requestIndex: number;
  readonly entryId: EntryId;
  readonly modelIndex: number;
  readonly originConversationId: ConversationId;
  readonly originals: readonly ImageOriginalBinding[];
};

/** Ephemeral compact metadata only. Valid authority also requires bridge.verify(). */
export type GenerationRequestProof = {
  readonly legacy?: false;
  readonly taskId: TaskId;
  readonly conversationId: ConversationId;
  readonly cutoff: EntryId;
  readonly attempt: number;
  readonly model: { readonly provider: string; readonly modelId: string };
  readonly submissionId: SubmissionId;
  readonly operationId: string;
  readonly current: ImageBoundInput;
  readonly inputs: readonly InputOccurrence[];
};

export type LegacyNativeInput = {
  readonly operationId: string;
  readonly submissionId: SubmissionId;
  readonly conversationId: ConversationId;
  readonly entryId: EntryId;
  readonly modelIndex: 0;
  readonly ownerId: string;
  readonly chatId: string;
  readonly chatScope: string;
  readonly throughEntryId: number;
};
export type LegacyGenerationRequestProof = Omit<
  GenerationRequestProof,
  "current" | "inputs" | "legacy"
> & {
  readonly legacy: true;
  readonly current: LegacyNativeInput;
  readonly inputs: readonly [];
};
export type GenerationRequestTicketProof = GenerationRequestProof | LegacyGenerationRequestProof;

export type ImageRequestBridge = {
  readonly extension: Extension;
  take(messages: readonly Message[]): GenerationRequestTicketProof | null;
  verify(proof: GenerationRequestTicketProof, context: ImageNativeContext): Promise<boolean>;
};

export type ImageRequestTicket = {
  readonly messages: readonly Message[];
  readonly proof: GenerationRequestTicketProof;
};
