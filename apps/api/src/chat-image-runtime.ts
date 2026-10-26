import { createAI } from "agents/models/pi-ai";
import type { ContextView, Harness, Registry, Storage } from "@earendil-works/pi-durable";
import { ROOT_CONVERSATION_ID as ROOT } from "@earendil-works/pi-durable";
import { readImageContextEvidence } from "./chat-image-context.ts";
import { ChatImageLegacyEra } from "./chat-image-legacy-era.ts";
import type { ConversationImageOptions as Options } from "./chat-image-runtime-options.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { ChatUnavailable, type SendMessage } from "./chat-model.ts";
import { PI_BACKGROUND } from "./chat-runtime.ts";
import { retainConversationFiles } from "./chat-conversation-files.ts";
import {
  createImageGenerationBinding,
  type ImageGenerationTransport,
} from "./chat-image-binding.ts";
import { recoverChatImageCalls } from "./chat-image-call-recovery.ts";
import { bindAcceptedImageDelivery } from "./chat-image-delivery.ts";
import { reconstructPendingImageInputs } from "./chat-image-reconstruction-run.ts";
import { ChatImageResponseStore } from "./chat-image-response-store.ts";
import type { ImageNativeContext, ImageRequestAccess } from "./chat-image-request-types.ts";
import {
  installConversationImages,
  createConversationImageAccess,
} from "./chat-image-runtime-install.ts";
import { prepareChatImageSend } from "./chat-image-send-preparation.ts";
import { prepareChatImageRecovery } from "./chat-image-recovery-preparation.ts";
import { retainAcceptedImageInput } from "./chat-image-retention.ts";
import type { SkillRequestGuard } from "./chat-skills-guard.ts";
import type { ConversationSkills } from "./chat-skills-runtime.ts";
import type { SkillRecoveryImageInput } from "./chat-skills-recovery-image-input.ts";
import type { ChatSendScope, PreparedChatSend } from "./chat-submission.ts";
export class ConversationImages {
  readonly modelProvider: ReturnType<typeof createAI>["provider"] | null;
  private readonly responses: ChatImageResponseStore;
  private readonly options: Options;
  private readonly legacyEra: ChatImageLegacyEra;
  private readonly transport: ImageGenerationTransport | null;
  private request: ImageRequestAccess | null = null;
  private raw: Harness | null = null;
  private ready = false;
  private callsReady = false;
  constructor(options: Options) {
    this.options = options;
    this.responses = new ChatImageResponseStore(options.ctx.storage);
    this.legacyEra = new ChatImageLegacyEra(options.ctx.storage);
    const tracked =
      options.env.AI === undefined ? null : createImageGenerationBinding(options.env.AI);
    this.transport = tracked?.transport ?? null;
    const gatewayId = options.env.CHAT_GATEWAY_ID;
    this.modelProvider =
      tracked !== null && gatewayId
        ? createAI({ binding: tracked.binding, id: gatewayId }).provider
        : null;
  }
  install(
    storage: Storage,
    context: ImageNativeContext,
    registry: Registry,
    skills: ConversationSkills,
  ): SkillRequestGuard["prepare"] {
    const access = createConversationImageAccess({
      account: this.options.account,
      storage,
      responses: this.responses,
      legacyEra: this.legacyEra,
      ready: () => this.ready,
      rawHarness: () => {
        if (this.raw === null) throw new ChatUnavailable();
        return this.raw;
      },
    });
    this.request = access;
    return installConversationImages({
      env: this.options.env,
      request: access,
      context,
      registry,
      skills,
      calls: this.options.calls,
      transport: this.transport,
      callsReady: () => this.callsReady,
      notify: this.options.notify,
      waitUntil: (work) => this.options.ctx.waitUntil(work),
    });
  }
  private access(): ImageRequestAccess {
    if (this.request === null) throw new ChatUnavailable();
    return this.request;
  }
  nativeAccess() {
    return this.access();
  }
  acceptedInput = (id: number) => this.responses.forEntry(String(ROOT), id, 0)?.candidate ?? null;
  contextEvidence(view: ContextView) {
    return readImageContextEvidence(this.access(), view, PI_BACKGROUND);
  }
  private async reconstruct(context: ImageNativeContext): Promise<boolean> {
    const access = this.access();
    return reconstructPendingImageInputs(
      {
        account: this.options.account,
        responses: this.responses,
        conversationId: access.conversationId,
        storage: access.storage,
        ownerId: access.ownerId,
        chatId: access.chatId,
        closed: () => !this.ready && this.options.fence.isHeld,
      },
      context,
    );
  }
  private async recoverCalls(context: ImageNativeContext): Promise<void> {
    if (this.callsReady) return;
    const access = this.access();
    // While false the installed host refuses before local admission: these remain cold-start keys.
    try {
      this.callsReady = await recoverChatImageCalls(
        this.options.calls,
        this.options.env.ChatCatalog?.getByName(`owner:${access.ownerId}`),
        access.chatId,
        context,
      );
    } catch {
      // Image accounting recovery cannot grant paid work or disable ordinary text lineage.
      this.callsReady = false;
    }
  }
  async beforeResume(
    harness: Harness,
    context: ImageNativeContext,
    skills: ConversationSkills,
  ): Promise<void> {
    this.raw = harness;
    this.ready = false;
    const acquired = this.options.fence.tryEnter();
    try {
      const inputsReady = await this.reconstruct(context);
      // Failure denies legacy fallback; it never grants readiness or blocks raw read access.
      await this.legacyEra
        .initialize(this.access(), context, () => !this.ready && this.options.fence.isHeld)
        .catch(() => undefined);
      await this.recoverCalls(context);
      const recovered = await skills.recoverBeforeResumeOn(harness, context);
      this.ready = inputsReady && (recovered.status === "ready" || recovered.aborted);
    } finally {
      if (acquired) this.options.fence.leave();
    }
  }
  private async beforeAdmission(): Promise<void> {
    if (!this.options.fence.isHeld) throw new ChatUnavailable();
    this.ready = false;
    if (!(await this.reconstruct(PI_BACKGROUND))) throw new ChatUnavailable();
    await this.recoverCalls(PI_BACKGROUND);
    this.ready = true;
  }
  private preparation() {
    return {
      account: this.options.account,
      responses: this.responses,
      conversationId: this.access().conversationId,
      nativeContext: PI_BACKGROUND,
      referenceFiles: this.options.env,
      imageGatewayId: () =>
        this.options.env.AI !== undefined && this.options.env.CHAT_FILES !== undefined
          ? (this.options.env.CHAT_GATEWAY_ID ?? null)
          : null,
    };
  }
  async prepare(
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    model: ChatCatalogModel,
  ): Promise<PreparedChatSend> {
    await this.beforeAdmission();
    await this.options.validateContext(model, (view) => this.contextEvidence(view));
    return prepareChatImageSend(this.preparation(), input, scope, model);
  }
  async prepareRecovery(input: SkillRecoveryImageInput) {
    await this.beforeAdmission();
    return prepareChatImageRecovery(
      {
        preparation: this.preparation(),
        proof: this.access(),
        records: this.options.records,
        env: this.options.env,
        validateContext: (model) =>
          this.options.validateContext(model, (view) => this.contextEvidence(view)),
      },
      input,
    );
  }
  async retain(input: typeof SendMessage.Type, scope: ChatSendScope): Promise<void> {
    if (this.responses.read(input.operationId) === null) {
      await retainConversationFiles(this.options.env, input, scope);
      return;
    }
    const access = this.access();
    const bound = await bindAcceptedImageDelivery(access, input.operationId, PI_BACKGROUND);
    await retainAcceptedImageInput(access, this.options.env, bound, PI_BACKGROUND);
  }
}
