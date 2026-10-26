import type * as cf from "@cloudflare/workers-types";
import {
  ROOT_CONVERSATION_ID,
  type Harness,
  type Registry,
  type Storage,
} from "@earendil-works/pi-durable";
import { boundOwner, type AccountPreparationDeps } from "./chat-account-preparation.ts";
import { DomainUuid } from "./chat-capabilities.ts";
import { decodeOption } from "./chat-internal.ts";
import { ChatUnavailable } from "./chat-model.ts";
import type { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { ChatImageLegacyEra } from "./chat-image-legacy-era.ts";
import { createImageExtension } from "@abhishek944/pi-image-gen/durable";
import type { CloudflareRun } from "@abhishek944/pi-image-gen/core";
import type { OfficeTaskEnvironment } from "./chat-office-transport.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import type { ImageGenerationTransport } from "./chat-image-binding.ts";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import { createImageGenerationGuard } from "./chat-image-generation.ts";
import { createChatImageHost } from "./chat-image-host.ts";
import { createImageRequestBridge } from "./chat-image-request-bridge.ts";
import type { ImageNativeContext, ImageRequestAccess } from "./chat-image-request-types.ts";
import { repairImageRequestOriginals } from "./chat-image-retention.ts";
import type { SkillRequestGuard } from "./chat-skills-guard.ts";
import type { ConversationSkills } from "./chat-skills-runtime.ts";

export type ConversationImageEnv = ConversationFileEnv &
  OfficeTaskEnvironment & {
    AI?: cf.Ai;
    CHAT_GATEWAY_ID?: string;
  };

/** Derive immutable proof scope from the actual server-assigned actor and owner binding. */
export const createConversationImageAccess = (input: {
  readonly account: AccountPreparationDeps;
  readonly storage: Storage;
  readonly responses: ChatImageResponseStore;
  readonly legacyEra: ChatImageLegacyEra;
  readonly ready: () => boolean;
  readonly rawHarness: () => Harness;
}): ImageRequestAccess => {
  const ownerId = boundOwner(input.account);
  const chatId = decodeOption(DomainUuid, input.account.chatName()?.slice(-36));
  if (
    ownerId === null ||
    chatId === null ||
    input.account.chatName() !== `chat:${ownerId}:${chatId}`
  )
    throw new ChatUnavailable();
  return {
    storage: input.storage,
    inputs: input.responses,
    responses: input.responses,
    legacyEra: input.legacyEra,
    ownerId,
    chatId,
    chatScope: input.account.chatScope(),
    conversationId: ROOT_CONVERSATION_ID,
    owner: () => boundOwner(input.account),
    ready: input.ready,
    rawHarness: input.rawHarness,
  };
};

/** Catalog model aliases are newer than the generated AiModels overloads; preserve real binding calls. */
const actualImageRun =
  (binding: cf.Ai): CloudflareRun =>
  async (model, input, options) => {
    const method: unknown = Reflect.get(binding, "run");
    if (typeof method !== "function") throw new Error("Image binding is unavailable.");
    const result: unknown = await Reflect.apply(method, binding, [model, input, options]);
    return result;
  };

/** Install all authority seams together; the gate remains closed until actual startup recovery. */
export const installConversationImages = (input: {
  readonly env: ConversationImageEnv;
  readonly request: ImageRequestAccess;
  readonly context: ImageNativeContext;
  readonly registry: Registry;
  readonly skills: ConversationSkills;
  readonly calls: ChatImageCallStore;
  readonly transport: ImageGenerationTransport | null;
  readonly callsReady: () => boolean;
  readonly notify: () => void;
  readonly waitUntil: (work: Promise<void>) => void;
}): SkillRequestGuard["prepare"] => {
  const bridge = createImageRequestBridge(input.request);
  input.registry.install(bridge.extension);
  const catalog = input.env.ChatCatalog?.getByName(`owner:${input.request.ownerId}`);
  const bucket = input.env.CHAT_FILES;
  const gatewayId = input.env.CHAT_GATEWAY_ID;
  if (catalog !== undefined && bucket !== undefined && input.env.AI !== undefined && gatewayId) {
    const host = createChatImageHost({
      storage: input.request.storage,
      proofAccess: input.request,
      calls: input.calls,
      catalog,
      expectedOwnerScope: catalog.id.toString(),
      bucket,
      cloudflareRun: actualImageRun(input.env.AI),
      configurationReady: (frozen) => input.callsReady() && frozen.gatewayId === gatewayId,
      dispatchGate: (operationId) => input.skills.assertDispatchAllowed(operationId),
      dispatchFence: (operationId) => input.skills.dispatchBlocked(operationId),
      notify: input.notify,
      waitUntil: input.waitUntil,
    });
    input.registry.install(createImageExtension(host));
  }
  if (input.transport === null)
    return async () => ({ ok: false, message: "The configured model transport is unavailable." });
  return createImageGenerationGuard({
    request: input.request,
    bridge,
    skills: input.skills,
    context: input.context,
    transport: input.transport,
    ...(catalog === undefined ? {} : { catalog }),
    ...(bucket === undefined ? {} : { bucket }),
    repairAccepted: (proof, context) =>
      repairImageRequestOriginals(input.request, input.env, proof, context),
  });
};
