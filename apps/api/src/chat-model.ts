import { Schema } from "effect";
import { ChatSelection } from "./chat-capabilities.ts";
import { AttachmentReferences, FileDescriptor } from "./chat-attachment-schema.ts";
import { UsageAmount } from "./chat-usage-schema.ts";

const Uuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);

export const ChatId = Uuid;
export const OperationId = Uuid;

/** Initial model only; explicit per-send selections are validated independently. */
export const CHAT_MODEL = { provider: "cloudflare", id: "openai/gpt-6-luna" } as const;

export const Chat = Schema.Struct({
  id: ChatId,
  title: Schema.String,
  archived: Schema.Boolean,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type Chat = typeof Chat.Type;

export const Position = Schema.Struct({ entryId: Schema.Number, modelIndex: Schema.Number });
export type Position = typeof Position.Type;

export const Coverage = Schema.Struct({
  ceilingEntryId: Schema.NullOr(Schema.Number),
  through: Schema.NullOr(Position),
  historyCursor: Schema.NullOr(Schema.String),
});
export type Coverage = typeof Coverage.Type;

export const TextInfo = Schema.Struct({
  textState: Schema.Literals(["complete", "preview"]),
  textRevision: Schema.String,
  textCursor: Schema.NullOr(Schema.String),
});
export type TextInfo = typeof TextInfo.Type;

export const ChatMessage = Schema.Struct({
  id: Schema.String,
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  createdAt: Schema.String,
  operationId: Schema.NullOr(OperationId),
  attachments: Schema.Array(FileDescriptor).check(Schema.isMaxLength(5)),
  usage: Schema.NullOr(UsageAmount),
  textState: Schema.Literals(["complete", "preview"]),
  textRevision: Schema.String,
  textCursor: Schema.NullOr(Schema.String),
});
export type ChatMessage = typeof ChatMessage.Type;

export const ChatSnapshot = Schema.Struct({
  chat: Chat,
  messages: Schema.Array(ChatMessage),
  history: Coverage,
  isRunning: Schema.Boolean,
  activeOperationId: Schema.NullOr(OperationId),
  error: Schema.NullOr(Schema.String),
  model: Schema.String.check(Schema.isMaxLength(128)),
  thinking: Schema.String.check(Schema.isMaxLength(40)),
  usageRevision: Schema.String.check(Schema.isMaxLength(128)),
});
export type ChatSnapshot = typeof ChatSnapshot.Type;

export const ChatIdParams = Schema.Struct({ id: ChatId });

export const Title = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(120),
);

export const CreateChat = Schema.Struct({ id: ChatId });

export const PatchChat = Schema.Struct({
  title: Schema.optional(Title),
  archived: Schema.optional(Schema.Boolean),
});

export const SendMessage = Schema.Struct({
  text: Schema.String.check(Schema.isTrimmed(), Schema.isMaxLength(16000)),
  operationId: OperationId,
  selection: ChatSelection,
  attachments: AttachmentReferences,
});

export const StopChat = Schema.Struct({ operationId: OperationId });

export const Stopped = Schema.Struct({ ok: Schema.Literal(true) });
export const Accepted = Schema.Struct({ accepted: Schema.Literal(true) });

export class ChatNotFound extends Schema.TaggedError<ChatNotFound>()(
  "ChatNotFound",
  {},
  { httpApiStatus: 404 },
) {}

export class ChatForbidden extends Schema.TaggedError<ChatForbidden>()(
  "ChatForbidden",
  {},
  { httpApiStatus: 403 },
) {}

export class ChatInvalid extends Schema.TaggedError<ChatInvalid>()(
  "ChatInvalid",
  { message: Schema.String },
  { httpApiStatus: 400 },
) {}

export class ChatBusy extends Schema.TaggedError<ChatBusy>()(
  "ChatBusy",
  {},
  { httpApiStatus: 409 },
) {}

export class ChatArchived extends Schema.TaggedError<ChatArchived>()(
  "ChatArchived",
  {},
  { httpApiStatus: 409 },
) {}

export class ChatRateLimited extends Schema.TaggedError<ChatRateLimited>()(
  "ChatRateLimited",
  {},
  { httpApiStatus: 429 },
) {}

export class ChatUnavailable extends Schema.TaggedError<ChatUnavailable>()(
  "ChatUnavailable",
  {},
  { httpApiStatus: 503 },
) {}

export class InferenceUnavailable extends Schema.TaggedError<InferenceUnavailable>()(
  "InferenceUnavailable",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

/** A configured stage where the submission itself failed before an answer. */
export class SubmissionFailed extends Schema.TaggedError<SubmissionFailed>()(
  "SubmissionFailed",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

export class PayloadTooLarge extends Schema.TaggedError<PayloadTooLarge>()(
  "PayloadTooLarge",
  { message: Schema.String },
  { httpApiStatus: 413 },
) {}

export class RefreshRequired extends Schema.TaggedError<RefreshRequired>()(
  "RefreshRequired",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Safe, non-diagnostic inference failure text shared by worker and object code. */
export const INFERENCE_FAILURE =
  "The model request failed. Check the development gateway and its key setup, then retry.";
export const INFERENCE_UNCONFIGURED =
  "Inference is not configured for this stage. Set CHAT_GATEWAY_ID to enable the chat gateway.";
export const SUBMISSION_FAILED =
  "Acceptance of the message could not be confirmed. Retry the same message; the same operation id never creates duplicate work.";
export const PAYLOAD_TOO_LARGE = "The request body is too large for the chat API.";
