import type { ConversationId, Storage, UserInput } from "@earendil-works/pi-durable";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import type { OfficeTaskEnvironment } from "./chat-office-transport.ts";
import type { AccountPreparationDeps } from "./chat-account-preparation.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { ImageOriginalBinding, ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { ChatReferenceInputs, OfficeSendTarget } from "@starter/office-contract";

export class ImageInputError extends Error {
  readonly code:
    | "invalid_input"
    | "unavailable"
    | "conflict"
    | "cancelled"
    | "gate_open"
    | "corrupt"
    | "queued";
  constructor(code: ImageInputError["code"]) {
    super(`Image input: ${code}`);
    this.name = "ImageInputError";
    this.code = code;
  }
}

export type ImageInputAccess = {
  readonly account: AccountPreparationDeps;
  readonly responses: ChatImageResponseStore;
  /** Actual raw SDK conversation identity, not a cast of an application string. */
  readonly conversationId: ConversationId;
};

export type ImageInputSource = {
  readonly source: "upload" | "saved";
  readonly fileId: string;
  /** Optional existing SERVER-VERIFIED sidecar binding; never browser/model metadata. */
  readonly original?: ImageOriginalBinding;
};

export type ImageInputRequest = {
  readonly operationId: string;
  readonly logicalOperationId: string;
  readonly identityHash: string;
  readonly ownerId: string;
  readonly chatId: string;
  /** Authenticated actual public request origin forwarded by the parent. */
  readonly applicationOrigin: string;
  readonly text: string;
  readonly officeTarget?: OfficeSendTarget;
  readonly referenceInputs?: ChatReferenceInputs | undefined;
  readonly sources: readonly ImageInputSource[];
  readonly model: ChatCatalogModel;
};

export type ImageInputPreparationAccess = ImageInputAccess & {
  readonly nativeContext: Parameters<Storage["submissionByRequest"]>[2];
  readonly referenceFiles: ConversationFileEnv & OfficeTaskEnvironment;
  /** Null unless the actual trusted image binding/stage route is configured. */
  readonly imageGatewayId: () => string | null;
};

export type PreparedImageInput = {
  readonly content: UserInput;
  readonly files: readonly FileDescriptor[];
  readonly candidate: ImageResponseCandidate;
  readonly uploadIds: readonly string[];
  /** R2 owner scope is separate from candidate.chatScope (conversation DO scope). */
  readonly ownerScope: string;
  readonly reused: boolean;
};
