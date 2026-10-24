import type { Ai } from "@cloudflare/workers-types";
import type { AgentContext } from "agents";
import type { Registry, Storage } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import {
  prepareAccountOperation,
  type AccountPreparationDeps,
} from "./chat-account-preparation.ts";
import { ChatAdmissionFence } from "./chat-admission-fence.ts";
import { ChatAccounting } from "./chat-accounting.ts";
import { chatObjectMetadata } from "./chat-observation.ts";
import {
  releaseConversationFiles,
  validateChatImageContext,
  type ConversationFileEnv,
} from "./chat-conversation-files.ts";
import { ChatLedger } from "./chat-ledger.ts";
import { CHAT_MODEL } from "./chat-model.ts";
import { configuredChatPolicy } from "./chat-preferences-http.ts";
import { ChatRuntime } from "./chat-runtime.ts";
import { ChatSendRecords } from "./chat-send-records.ts";
import { ChatSource } from "./chat-source.ts";
import { ChatSubmission } from "./chat-submission.ts";
import type { ChatSkillsRecovery } from "./chat-skills-recovery.ts";
import type { ConversationSkills } from "./chat-skills-runtime.ts";
import {
  conversationHarnessFactory,
  conversationSkillGates,
  conversationSkillSource,
  createConversationSkillRecovery,
  createConversationSkills,
  skillAttemptProvenance,
  skillRecoveryView,
} from "./chat-skills-conversation.ts";
import { readSkillReadiness } from "./chat-skills-readiness.ts";
import { ChatSkillsNoAdmissions } from "./chat-skills-no-admission.ts";
import { ChatSkillsStore } from "./chat-skills-store.ts";
import { ChatOwnerBinding, conversationOwner } from "./chat-tool-authorization.ts";
import { conversationCatalogStub } from "./chat-conversation-catalog.ts";
import { conversationRecoveryAdmission } from "./chat-skills-recovery-admission.ts";
import { ChatImageCallStore } from "./chat-image-call-store.ts";
import { ConversationImages } from "./chat-image-runtime.ts";
import { ChatOfficeTaskBroker } from "./chat-office-task-broker.ts";
import { createOfficePiHost } from "./chat-office-host.ts";
import type { OfficeTaskEnvironment } from "./chat-office-transport.ts";
export type SkillConversationEnv = ConversationFileEnv &
  OfficeTaskEnvironment & {
    AI?: Ai;
    CHAT_GATEWAY_ID?: string;
    CHAT_MODEL_ALLOWLIST?: string;
  };
export type ChatConversationServices = {
  readonly ledger: ChatLedger;
  readonly runtime: ChatRuntime;
  readonly submission: ChatSubmission;
  readonly source: ChatSource;
  readonly accounting: ChatAccounting;
  readonly imageCalls: ChatImageCallStore;
  readonly images: ConversationImages;
  readonly officeTasks: ChatOfficeTaskBroker;
  readonly owners: ChatOwnerBinding;
  readonly account: AccountPreparationDeps;
  readonly skills: ConversationSkills;
  readonly skillsStore: ChatSkillsStore;
  readonly recovery: ChatSkillsRecovery;
  readonly harness: PiHarness;
};
export const createChatConversationServices = (
  ctx: AgentContext,
  env: SkillConversationEnv,
): ChatConversationServices => {
  const records = new ChatSendRecords(ctx.storage.sql),
    ledger = new ChatLedger(ctx.storage.sql);
  const imageCalls = new ChatImageCallStore(ctx.storage);
  const owners = new ChatOwnerBinding(ctx.storage);
  const derivedOwner = conversationOwner(ctx.id.name);
  if (derivedOwner !== null) owners.bind(derivedOwner, Date.now());

  const accounting = new ChatAccounting(
    ctx.storage.sql,
    () => source.invalidateUsage(),
    chatObjectMetadata(env),
  );
  const fence = new ChatAdmissionFence(),
    noAdmissions = new ChatSkillsNoAdmissions(ctx.storage.sql);
  let registryRef: Registry | null = null,
    toolStorage: Storage | null = null;
  let harness: PiHarness, runtime: ChatRuntime;
  const skillsStore = new ChatSkillsStore(ctx.storage.sql);
  const skills = createConversationSkills({
    store: skillsStore,
    env,
    owners,
    records,
    registry: () => registryRef,
    runtime: () => runtime,
    notify: () => source.invalidateUsage(),
  });
  const account: AccountPreparationDeps = {
    owners,
    chatName: () => ctx.id.name,
    chatScope: () => ctx.id.toString(),
    conversationId: async () => String(await runtime.conversationId()),
    accountOperation: (operationId) => records.account(operationId),
    catalog: (ownerId) => conversationCatalogStub(env, ownerId),
    storage: () => {
      if (toolStorage === null) throw new Error("Account tools require an open harness storage");
      return toolStorage;
    },
    ...conversationSkillGates(skills),
  };
  const images = new ConversationImages({
    ctx,
    env,
    account,
    records,
    calls: imageCalls,
    fence,
    notify: () => source.invalidateUsage(),
    validateContext: (model, readEvidence) =>
      validateChatImageContext(runtime, model, readEvidence),
  });
  const officeTasks = new ChatOfficeTaskBroker(() => images.nativeAccess(), records);
  harness = new PiHarness({
    harness: conversationHarnessFactory({
      setProvider: (models) => {
        if (images.modelProvider !== null) models.setProvider(images.modelProvider);
      },
      accounting,
      account,
      skills,
      images,
      office: createOfficePiHost(env, () => images.nativeAccess(), officeTasks),
      displayOffice: (target) => source.requestPanel(target),
      selection: () => runtime.selection(),
      setRegistry: (registry) => {
        registryRef = registry;
      },
      setStorage: (storage) => {
        toolStorage = storage;
      },
    }),
    defaults: { model: CHAT_MODEL, thinkingLevel: "high" },
  });
  runtime = new ChatRuntime(harness, ledger, records);
  const submission = new ChatSubmission({
    harness,
    runtime,
    ledger,
    records,
    enabled: images.modelProvider !== null,
    fence,
    noAdmissions,
    policy: configuredChatPolicy(env.CHAT_MODEL_ALLOWLIST),
    prepare: (input, scope, model) => images.prepare(input, scope, model),
    prepareAccount: (input, scope) => prepareAccountOperation(account, input, scope),
    retain: (input, scope) => images.retain(input, scope),
    release: (input, scope) => releaseConversationFiles(env, input, scope),
    skills,
  });
  const recovery = createConversationSkillRecovery({
    harness,
    runtime,
    ledger,
    records,
    store: skillsStore,
    skills,
    fence,
    noAdmissions,
    notify: () => source.invalidateUsage(),
    policy: configuredChatPolicy(env.CHAT_MODEL_ALLOWLIST),
    enabled: images.modelProvider !== null,
    prepareImages: (input) => images.prepareRecovery(input),
    readiness: () => readSkillReadiness(conversationSkillSource(env, owners), owners.owner()),
    prepareAccount: (input, scope) => prepareAccountOperation(account, input, scope),
    ...conversationRecoveryAdmission(env),
  });
  const source = new ChatSource(
    runtime,
    () => skillRecoveryView(skillsStore),
    (entry, index) => imageCalls.hasAssistantFiles(entry, index),
    (operationId) => skillAttemptProvenance(skillsStore, operationId),
  );
  return {
    ledger,
    runtime,
    submission,
    source,
    accounting,
    imageCalls,
    images,
    officeTasks,
    owners,
    account,
    skills,
    skillsStore,
    recovery,
    harness,
  };
};
