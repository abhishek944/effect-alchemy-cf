import type { ChatObjectContext } from "./chat-object.ts";
import { createModels } from "@earendil-works/pi-ai/models";
import { configuredChatProvider } from "./chat-model-transport.ts";
import { reportFailure } from "@highchat/diagnostics";
import { ChatAdmissionFence } from "./chat-admission-fence.ts";
import { ChatSkillsNoAdmissions } from "./chat-skills-no-admission.ts";
import { ChatAccounting } from "./chat-accounting.ts";
import { chatObjectMetadata } from "./chat-observation.ts";
import { ChatLedger } from "./chat-ledger.ts";
import { ChatRuntime } from "./chat-runtime.ts";
import { ChatSendRecords } from "./chat-send-records.ts";
import { ChatSource } from "./chat-source.ts";
import { ChatSubmission } from "./chat-submission.ts";
import { ChatOwnerBinding, conversationOwner } from "./chat-tool-authorization.ts";
import { ChatImageCallStore } from "./chat-image-call-store.ts";
import { ChatImageResponseStore } from "./chat-image-response-store.ts";
import { ChatTranscript } from "./chat-transcript.ts";
import { ChatSdkHost, type ChatHostConfiguration } from "./chat-sdk-host.ts";
import { ChatSdkExecution } from "./chat-sdk-execution.ts";
import { createChatSdkAccount } from "./chat-sdk-account.ts";
import { createChatSdkSkills } from "./chat-sdk-skills.ts";
import { createSdkFileServices, type SdkFileEnv } from "./chat-sdk-file-services.ts";
import { configuredChatPolicy } from "./chat-preferences-http.ts";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { ChatUnavailable } from "./chat-model.ts";

export type SkillConversationEnv = SdkFileEnv &
  ChatHostConfiguration & { readonly CHAT_MODEL_ALLOWLIST?: string };
const configuredHost = (env: SkillConversationEnv): ChatSdkHost | null => {
  if (!env.CHAT_HOST_URL || !env.CHAT_HOST_TOKEN) return null;
  try {
    return new ChatSdkHost(env);
  } catch {
    reportFailure(undefined, {
      ...chatObjectMetadata(env),
      component: "chat-sdk",
      operation: "configure",
      reason: "invalid_host_configuration",
    });
    return null;
  }
};
export const createChatConversationServices = (
  ctx: ChatObjectContext,
  env: SkillConversationEnv,
) => {
  const records = new ChatSendRecords(ctx.storage.sql);
  const ledger = new ChatLedger(ctx.storage.sql);
  const transcript = new ChatTranscript(ctx.storage.sql);
  const responses = new ChatImageResponseStore(ctx.storage);
  const imageCalls = new ChatImageCallStore(ctx.storage);
  const owners = new ChatOwnerBinding(ctx.storage);
  const owner = conversationOwner(ctx.id.name);
  if (owner !== null) owners.bind(owner, Date.now());
  const runtime = new ChatRuntime(
    transcript,
    ledger,
    records,
    (entry) => responses.forEntry(String(transcript.id), entry, 0)?.candidate ?? null,
  );
  const source = new ChatSource(runtime, (entry, index) =>
    imageCalls.hasAssistantFiles(entry, index),
  );
  const accounting = new ChatAccounting(
    ctx.storage.sql,
    () => source.invalidateUsage(),
    chatObjectMetadata(env),
  );
  const fileServices = createSdkFileServices({
    ctx,
    env,
    runtime,
    owners,
    responses,
    calls: imageCalls,
  });
  const catalog = (ownerId: string) => {
    if (env.ChatCatalog === undefined) throw new ChatUnavailable();
    return env.ChatCatalog.getByName(`owner:${ownerId}`);
  };
  const skills = createChatSdkSkills({
    source: (ownerId) =>
      owners.owner() === ownerId && env.ChatCatalog !== undefined
        ? { catalog: catalog(ownerId), bucket: env.CHAT_FILES ?? null }
        : null,
    onFatal: (error) => runtime.active?.controller.abort(error),
  });
  const account = createChatSdkAccount({
    owners,
    chatName: () => ctx.id.name,
    chatScope: () => ctx.id.toString(),
    conversationId: async () => String(transcript.id),
    accountOperation: (operationId) => records.account(operationId),
    catalog,
  });
  const host = configuredHost(env);
  const models = createModels();
  const provider = configuredChatProvider(env);
  if (provider !== null) models.setProvider(provider);
  const execution =
    host === null
      ? null
      : new ChatSdkExecution({
          runtime,
          host,
          models,
          accounting,
          tools: [...account.descriptors, ...fileServices.tools],
          chatScope: () => ctx.id.toString(),
          waitUntil: (work) => ctx.waitUntil(work),
          hydrate: async (context, input, active) => {
            const files = fileServices.files;
            const model = installedChatModel(input.selection.model);
            if (files === null || model === null) throw new ChatUnavailable();
            return files.hydrate(
              fileServices.hydrateContext(context),
              model,
              active.controller.signal,
            );
          },
        });
  const submission = new ChatSubmission({
    runtime,
    enabled: host !== null && provider !== null,
    fence: new ChatAdmissionFence(),
    noAdmissions: new ChatSkillsNoAdmissions(ctx.storage.sql),
    policy: configuredChatPolicy(env.CHAT_MODEL_ALLOWLIST),
    skills,
    prepare: async (input, scope, model) => {
      const files = fileServices.files;
      if (files === null) throw new ChatUnavailable();
      const prepared = await files.prepare(input, scope, model);
      return {
        content: prepared.content,
        files: prepared.files,
        accept: async (entry: number) => {
          await files.accept(input.operationId, entry);
        },
        release: () => files.release(input.operationId, scope.chat.id),
      };
    },
    prepareAccount: (input, scope) => account.prepareAccount(input, scope),
    retainAccepted: async (input, _scope, entry) => {
      // Existing immutable sidecars repair only their own original bindings; no new model work.
      if (responses.read(input.operationId) !== null) {
        if (fileServices.files === null) throw new ChatUnavailable();
        if (entry === undefined) await fileServices.files.retain(input.operationId);
        else await fileServices.files.accept(input.operationId, entry);
      }
    },
    dispatch: (input, scope, entry, prepared) => {
      if (execution === null) throw new ChatUnavailable();
      execution.start(input, scope, entry, prepared);
    },
  });
  return {
    ledger,
    runtime,
    submission,
    source,
    accounting,
    imageCalls,
    owners,
    skills,
    estimateMessages: fileServices.estimateMessages,
  };
};
export type ChatConversationServices = ReturnType<typeof createChatConversationServices>;
