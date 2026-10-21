import type { UserInput } from "@earendil-works/pi-durable";
import type { PiHarness } from "agents/harness/pi";
import type { OfficeSessionBinding } from "@starter/auth/office-session";
import type { ChatAdmissionFence } from "./chat-admission-fence.ts";
import type { AccountOperationRecord } from "./chat-account-operations.ts";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { StageModelPolicy } from "./chat-capability-policy.ts";
import type { ChatLedger } from "./chat-ledger.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import type { ChatSkillsNoAdmissions } from "./chat-skills-no-admission.ts";
import type { SendMessage } from "./chat-model.ts";

export type PreparedChatSend = { content: UserInput; files: readonly FileDescriptor[] };
export type ChatSendScope = {
  chat: Chat;
  ownerId: string;
  applicationOrigin: string;
  /** Genuine original private Send association only; metadata is not an Office grant. */
  officeSession?: OfficeSessionBinding;
};

/** Conversation-owned skills lifecycle used at the admission boundary. */
export type ChatSkillsPort = {
  readonly prepareNew: (input: {
    readonly ownerId: string;
    readonly attemptId: string;
    readonly content: UserInput;
  }) => Promise<void>;
  readonly accept: (operationId: string) => void;
  readonly release: (operationId: string) => void;
};

export type ChatSubmissionOptions = {
  harness: PiHarness;
  runtime: ChatRuntime;
  ledger: ChatLedger;
  records: ChatSendRecords;
  policy: StageModelPolicy;
  enabled: boolean;
  skills: ChatSkillsPort;
  /** Shared reject-not-queue fence across Send, Retry and New Send. */
  fence: ChatAdmissionFence;
  /** Shared bounded negative authority; a fenced UUID never executes again. */
  noAdmissions: ChatSkillsNoAdmissions;
  prepare: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    model: ChatCatalogModel,
  ) => Promise<PreparedChatSend>;
  /** Same-insert immutable account evidence; duplicates never amend original authority. */
  prepareAccount: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
  ) => Promise<AccountOperationRecord | null>;
  retain: (input: typeof SendMessage.Type, scope: ChatSendScope) => Promise<void>;
  release: (input: typeof SendMessage.Type, scope: ChatSendScope) => Promise<void>;
};
