import type { AgentContext } from "agents";
import type { AccountPreparationDeps } from "./chat-account-preparation.ts";
import type { ChatAdmissionFence } from "./chat-admission-fence.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import type { ReadImageContextEvidence } from "./chat-image-context.ts";
import type { ConversationImageEnv } from "./chat-image-runtime-install.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";

/** Native lifecycle dependencies; metadata consumers never receive hydrated originals. */
export type ConversationImageOptions = {
  readonly ctx: AgentContext;
  readonly env: ConversationImageEnv;
  readonly account: AccountPreparationDeps;
  readonly records: ChatSendRecords;
  readonly calls: ChatImageCallStore;
  readonly fence: ChatAdmissionFence;
  readonly notify: () => void;
  readonly validateContext: (
    model: ChatCatalogModel,
    readEvidence: ReadImageContextEvidence,
  ) => Promise<void>;
};
