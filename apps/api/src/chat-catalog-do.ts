import { Agent, type AgentContext } from "agents";
import { ChatAdmission } from "./chat-admission.ts";
import { ChatCatalogData } from "./chat-catalog-data.ts";
import { ChatCatalogFiles, type CatalogFilesEnv } from "./chat-catalog-files.ts";
import { catalogPreferences, configuredChatPolicy } from "./chat-preferences-http.ts";
import { ChatPreferencesStore } from "./chat-preferences-store.ts";
import { profileCatalog, sweepProfileObjects } from "./profile-catalog-http.ts";
import { ProfileObjects } from "./profile-objects.ts";
import { reconcileAvatarOrphans } from "./profile-orphan-scan.ts";
import { ProfileStore } from "./profile-store.ts";
import { themeCatalog } from "./theme-catalog-http.ts";
import { ThemeStore } from "./theme-store.ts";
import { resolveChatSelectionValue, type StageModelPolicy } from "./chat-capability-policy.ts";
import { ChatCatalogSpeech } from "./chat-catalog-speech.ts";
import { reportTitleUsage } from "./chat-external-usage.ts";
import {
  CatalogAdmitBody,
  CatalogOperationBody,
  CatalogReleaseBody,
  CatalogTitleClaimBody,
  decodeOption,
  digestText,
  json,
  requestBody,
} from "./chat-internal.ts";
import { type ChatTitleEnv, ChatTitles } from "./chat-title-store.ts";

type ChatEnv = ChatTitleEnv & CatalogFilesEnv & { CHAT_MODEL_ALLOWLIST?: string };

/** One private metadata, preference and paid-admission catalog per authenticated owner. */
export class ChatCatalog extends Agent<ChatEnv> {
  private readonly admission: ChatAdmission;
  private readonly titles: ChatTitles;
  private readonly preferences: ChatPreferencesStore;
  private readonly profile: ProfileStore;
  private readonly objects: ProfileObjects;
  private readonly themes: ThemeStore;
  private readonly policy: StageModelPolicy;
  private readonly data: ChatCatalogData;
  private readonly files: ChatCatalogFiles;
  private readonly speech: ChatCatalogSpeech;

  constructor(ctx: AgentContext, env: ChatEnv) {
    super(ctx, env);
    this.preferences = new ChatPreferencesStore(ctx.storage);
    this.objects = new ProfileObjects(ctx.storage);
    this.profile = new ProfileStore(ctx.storage, this.objects);
    this.themes = new ThemeStore(ctx.storage);
    this.policy = configuredChatPolicy(env.CHAT_MODEL_ALLOWLIST);
    this.admission = new ChatAdmission(ctx.storage.sql);
    this.data = new ChatCatalogData(ctx.storage, this.preferences);
    this.speech = new ChatCatalogSpeech(ctx.storage, this.preferences);
    this.files = new ChatCatalogFiles(
      ctx,
      env,
      (id) => this.data.find(id),
      () => this.data.ownerId(),
    );
    this.titles = new ChatTitles({
      db: ctx.storage.sql,
      env,
      waitUntil: (task) => ctx.waitUntil(task),
      chat: (id) => this.data.find(id),
      nextUpdatedAt: (previous) => this.data.nextUpdatedAt(previous),
      recordUsage: async (chatId, operationId, selection, response) =>
        reportTitleUsage({
          namespace: env.ChatConversation,
          ownerId: await this.data.ownerId(),
          chat: this.data.find(chatId),
          operationId,
          selection,
          response,
        }),
    });
  }

  /** SDK Scheduler owns its alarm; no competing alarm handler is installed. */
  async expireChatFiles(): Promise<void> {
    await this.files.cleanup();
  }

  /** Abandoned and never-saved avatar objects, retried until deletion succeeds. */
  async expireProfileObjects(): Promise<void> {
    await sweepProfileObjects(
      this.objects,
      this.env.CHAT_FILES,
      this.ctx.id.toString(),
      Date.now(),
    );
    await reconcileAvatarOrphans({
      storage: this.ctx.storage,
      objects: this.objects,
      profile: this.profile,
      bucket: this.env.CHAT_FILES,
      scope: this.ctx.id.toString(),
    });
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = `${request.method} ${url.pathname}`;
    try {
      const owner = request.headers.get("x-chat-owner");
      if (owner !== null && !(await this.data.bindOwner(owner)))
        return json({ message: "Invalid owner" }, 400);
      if (
        url.pathname.startsWith("/files/") &&
        request.method === "POST" &&
        this.env.CHAT_FILES !== undefined
      )
        await this.scheduleEvery(3600, "expireChatFiles");
      if (
        (url.pathname === "/profile/photo" || url.pathname === "/profile/photo/reserve") &&
        request.method === "POST" &&
        this.env.CHAT_FILES !== undefined
      )
        await this.scheduleEvery(3600, "expireProfileObjects");
      const profile = await profileCatalog(
        request,
        this.profile,
        this.objects,
        this.env,
        this.ctx.id.toString(),
      );
      if (profile !== null) return profile;
      const theme = await themeCatalog(request, this.themes);
      if (theme !== null) return theme;
      const files = await this.files.handle(request);
      if (files !== null) return files;
      const speech = await this.speech.handle(request);
      if (speech !== null) return speech;
      const preferences = await catalogPreferences(
        request,
        this.preferences,
        this.policy,
        (id) => this.data.find(id) !== null,
      );
      if (preferences !== null) return preferences;
      const metadata = await this.data.handle(request, this.titles);
      if (metadata !== null) return metadata;
      switch (route) {
        case "POST /title/claim": {
          const body = decodeOption(CatalogTitleClaimBody, await requestBody(request));
          if (body === null) return json({ message: "Invalid request" }, 400);
          if (!resolveChatSelectionValue(this.policy, body.selection).ok)
            return json({ claimed: false });
          const claimed = await this.titles.claim(
            body.operationId,
            body.id,
            body.text,
            body.identity,
            body.selection,
          );
          return json({ claimed });
        }
        case "POST /admit": {
          const body = decodeOption(CatalogAdmitBody, await requestBody(request));
          if (body === null) return json({ message: "Invalid request" }, 400);
          // No await between authoritative archive read and synchronous admission.
          const textHash = await digestText(body.identity);
          const chat = this.data.find(body.chatId);
          if (chat === null) return json({ message: "Not found" }, 404);
          if (chat.archived)
            return json({ admitted: false, duplicate: false, reason: "archived", attemptId: null });
          return json(
            this.admission.admit(
              body.operationId,
              body.chatId,
              textHash,
              body.now,
              body.nativeAccepted,
              body.attemptId,
            ),
          );
        }
        case "POST /finalize": {
          const body = decodeOption(CatalogOperationBody, await requestBody(request));
          if (body === null) return json({ message: "Invalid request" }, 400);
          this.admission.finalize(body.operationId, body.now);
          return json({ ok: true });
        }
        case "POST /release": {
          const body = decodeOption(CatalogReleaseBody, await requestBody(request));
          if (body === null) return json({ message: "Invalid request" }, 400);
          this.admission.release(body.operationId, body.attemptId);
          return json({ ok: true });
        }
        default:
          return json({ message: "Not found" }, 404);
      }
    } catch {
      return json({ message: "Chat catalog unavailable" }, 503);
    }
  }
}
