import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { ImageOriginalBinding } from "./chat-image-response-schema.ts";
import type { ChatReferenceInputs } from "@highchat/chat-contract";

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
  readonly referenceInputs?: ChatReferenceInputs | undefined;
  readonly sources: readonly ImageInputSource[];
  readonly model: ChatCatalogModel;
};
