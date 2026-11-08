/**
 * Neutral Worker contracts for compact chat files and the image tool.
 *
 * Authority is always the object-selected scope: the conversation owner binding,
 * the authenticated chat, and the transcript's accepted operation. No model
 * argument, browser string or legacy native proof selects an owner or original.
 */
import type * as cf from "./platform.ts";
import type { CloudflareRun } from "@abhishek944/pi-image-gen/core";
import type { AssistantMessage, Context, TextContent } from "@earendil-works/pi-ai";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import type {
  ImageAcceptedBinding,
  ImageBoundInput,
  ImageResponseCandidate,
} from "./chat-image-response-schema.ts";
import type { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { SendMessage } from "./chat-model.ts";
import type { ChatSdkTool, ChatToolScope } from "./chat-sdk-tool.ts";
import type { UserInput } from "./chat-transcript-types.ts";
import { conversationOwner } from "./chat-tool-authorization.ts";

export type ChatSdkFilesErrorCode =
  | "invalid_input"
  | "unavailable"
  | "conflict"
  | "cancelled"
  | "corrupt"
  | "gate";

const messages: Record<ChatSdkFilesErrorCode, string> = {
  invalid_input: "The files or references do not match this message.",
  unavailable: "The saved files are unavailable; their identity is unchanged.",
  conflict: "This operation belongs to a different immutable input.",
  cancelled: "The request was stopped before file preparation completed.",
  corrupt: "The saved file metadata could not be verified.",
  gate: "This request is not admitted for file access.",
};

/** Fixed code and message; never a foreign body, URL or owner identifier. */
export class ChatSdkFilesError extends Error {
  readonly code: ChatSdkFilesErrorCode;
  constructor(code: ChatSdkFilesErrorCode) {
    super(messages[code]);
    this.name = "ChatSdkFilesError";
    this.code = code;
  }
}

export type ChatSdkScopeDeps = {
  readonly chatName: () => string | undefined;
  readonly chatScope: () => string;
  readonly owners: { readonly owner: () => string | null };
  readonly conversationId: () => Promise<string>;
  readonly catalog: (ownerId: string) => cf.DurableObjectStub;
};

/** Owner from the server-assigned object name, verified against the durable binding. */
export const chatSdkOwner = (deps: ChatSdkScopeDeps): string | null => {
  const derived = conversationOwner(deps.chatName());
  return derived !== null && deps.owners.owner() === derived ? derived : null;
};

export type ChatSdkPrepareScope = {
  readonly chat: { readonly id: string };
  readonly ownerId: string;
  readonly applicationOrigin: string;
  readonly signal?: AbortSignal;
};

export type ChatSdkPrepared = {
  readonly candidate: ImageResponseCandidate;
  readonly content: TextInput;
  readonly files: readonly FileDescriptor[];
  readonly uploadIds: readonly string[];
  /** R2 owner scope is separate from the candidate conversation scope. */
  readonly ownerScope: string;
  readonly reused: boolean;
};

/** Compact text blocks only; original bytes never enter a persisted input. */
export type TextInput = readonly TextContent[];

/** Runtime proof for the compact persisted shape; image blocks never become history. */
export const isTextInput = (value: UserInput): value is TextInput =>
  typeof value !== "string" && value.every((block) => block.type === "text");

export type ChatSdkAcceptedMessage = {
  /** Exact position in the final pi-ai context messages array. */
  readonly requestIndex: number;
  readonly candidate: ImageResponseCandidate;
};

export type ChatSdkFilesDeps = ChatSdkScopeDeps & {
  readonly responses: ChatImageResponseStore;
  readonly bucket: cf.R2Bucket;
  /** Null unless the trusted stage actually has an image Gateway binding. */
  readonly imageGatewayId: () => string | null;
  /** Parent transcript mapping for every accepted compact user message. */
  readonly acceptedFor: (context: Context) => readonly ChatSdkAcceptedMessage[];
};

export type ChatSdkAcceptedImage = {
  readonly candidate: ImageResponseCandidate;
  readonly binding: ImageAcceptedBinding;
  /** Exact accepted assistant entry; callPosition is derived from its tool calls. */
  readonly assistant: AssistantMessage;
};

export type ChatSdkImagesDeps = ChatSdkScopeDeps & {
  readonly responses: ChatImageResponseStore;
  readonly bucket: cf.R2Bucket;
  readonly calls: ChatImageCallStore;
  /** The actual bound `AI.run` adapter; undefined refuses before any dispatch. */
  readonly cloudflareRun: CloudflareRun | undefined;
  readonly configurationReady: (
    image: Extract<ImageResponseCandidate["image"], { state: "ready" }>,
  ) => boolean;
  /** Live accepted operation plus its exact assistant entry, or null. */
  readonly accepted: (scope: ChatToolScope) => ChatSdkAcceptedImage | null;
  /** Transcript run record exists; the current placed operation also counts. */
  readonly isAcceptedOperation: (operationId: string) => boolean;
  /** Synchronous parent fence immediately before any paid reservation/dispatch. */
  readonly assertLive: (scope: ChatToolScope) => void;
};

export type ChatSdkInput = typeof SendMessage.Type;

export type ChatSdkFiles = {
  readonly prepare: (
    input: ChatSdkInput,
    scope: ChatSdkPrepareScope,
    model: ChatCatalogModel,
  ) => Promise<ChatSdkPrepared>;
  readonly accept: (operationId: string, entryId: number) => Promise<ImageBoundInput>;
  readonly retain: (operationId: string) => Promise<readonly FileDescriptor[]>;
  readonly release: (operationId: string, chatId: string) => Promise<void>;
  readonly hydrate: (
    context: Context,
    model: ChatCatalogModel,
    signal?: AbortSignal,
  ) => Promise<Context>;
};

export type ChatSdkImages = {
  readonly descriptors: readonly ChatSdkTool[];
};
