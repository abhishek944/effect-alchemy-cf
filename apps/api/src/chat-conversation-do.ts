import { Agent, type AgentContext } from "agents";
import type * as cf from "@cloudflare/workers-types";
import type { ChatImageCallStore } from "./chat-image-call-store.ts";
import type { ConversationImages } from "./chat-image-runtime.ts";
import { readConversationImages } from "./chat-image-read-http.ts";
import { conversationCatalogStub } from "./chat-conversation-catalog.ts";
import { conversationOwner } from "./chat-tool-authorization.ts";
import {
  ConversationSendBody,
  ConversationStopBody,
  ConversationTitleBody,
  chatFromHeader,
  decodeOption,
  json,
  requestBody,
} from "./chat-internal.ts";
import { readChat } from "./chat-reads.ts";
import { RefreshFence } from "./chat-source.ts";
import type { ChatSource } from "./chat-source.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import { streamChat } from "./chat-sse.ts";
import { SUBMISSION_FAILED } from "./chat-model.ts";
import { conversationApplicationOrigin } from "./chat-public-origin.ts";
import type { ChatAccounting } from "./chat-accounting.ts";
import type { ChatLedger } from "./chat-ledger.ts";
import type { ChatSubmission } from "./chat-submission.ts";
import type { ChatOwnerBinding } from "./chat-tool-authorization.ts";
import { conversationUsage } from "./chat-usage-http.ts";
import type { ChatSkillsRecovery } from "./chat-skills-recovery.ts";
import { conversationSkillsEndpoint } from "./chat-skills-conversation.ts";
import {
  createChatConversationServices,
  type SkillConversationEnv,
} from "./chat-conversation-services.ts";
import type { ConversationSkills } from "./chat-skills-runtime.ts";
import { chatOfficeSessionFromRequest } from "./chat-office-session.ts";
import { chatOfficeTaskEndpoint } from "./chat-office-task-http.ts";
import type { ChatOfficeTaskBroker } from "./chat-office-task-broker.ts";

type ChatEnv = SkillConversationEnv;

/**
 * One private conversation per owner and public chat id. Pi owns the
 * transcript and the run; this object projects snapshots, resolves public
 * operation identity from native submission records, and relays submission,
 * targeted cancellation and event attachment.
 */
export class ChatConversation extends Agent<ChatEnv> {
  private readonly ledger: ChatLedger;
  private readonly runtime: ChatRuntime;
  private readonly submission: ChatSubmission;
  private readonly source: ChatSource;
  private readonly accounting: ChatAccounting;
  private readonly owners: ChatOwnerBinding;
  private readonly skillRecovery: ChatSkillsRecovery;
  private readonly imageCalls: ChatImageCallStore;
  private readonly images: ConversationImages;
  private readonly officeTasks: ChatOfficeTaskBroker;
  private readonly imageCatalog: () => cf.DurableObjectStub;
  private readonly skills: ConversationSkills;

  constructor(ctx: AgentContext, env: ChatEnv) {
    super(ctx, env);
    const services = createChatConversationServices(ctx, env);
    this.ledger = services.ledger;
    this.runtime = services.runtime;
    this.submission = services.submission;
    this.source = services.source;
    this.accounting = services.accounting;
    this.owners = services.owners;
    this.skillRecovery = services.recovery;
    this.imageCalls = services.imageCalls;
    this.images = services.images;
    this.officeTasks = services.officeTasks;
    this.imageCatalog = () => {
      const owner = conversationOwner(ctx.id.name);
      if (owner === null || this.owners.owner() !== owner)
        throw new Error("Image owner binding is unavailable");
      return conversationCatalogStub(env, owner);
    };
    this.skills = services.skills;
    this.lifecycle.use(services.harness);
  }

  private async stop(operationId: string): Promise<Response> {
    try {
      // Exact native input/run task only; no placed-input conversation-wide wrapper.
      await this.runtime.stop(operationId);
    } catch {
      // A genuine abort failure must not be reported as success or masked as a stop.
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
    return json({ ok: true });
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const office = await chatOfficeTaskEndpoint(request, this.officeTasks);
    if (office !== null) return office;
    const chat = chatFromHeader(request.headers.get("x-chat-json"));
    if (chat === null) return json({ message: "Missing chat identity" }, 400);
    try {
      const usage = await conversationUsage(
        request,
        chat,
        this.runtime,
        this.accounting,
        (view) => this.images.contextEvidence(view),
        () => this.skills.projectionSections(),
      );
      if (usage !== null) return usage;
      const images = await readConversationImages({
        request,
        chat,
        runtime: this.runtime,
        calls: this.imageCalls,
        catalog: this.imageCatalog,
      });
      if (images !== null) return images;
      if (request.method === "GET" && url.pathname === "/events") {
        await this.source.initialize();
        return streamChat(
          {
            current: () => this.source.snapshot(chat),
            subscribe: (invalidate) => this.source.subscribe(invalidate),
          },
          request.signal,
        );
      }
      if (request.method === "GET" && url.pathname === "/snapshot") {
        return json(await this.source.snapshot(chat));
      }
      const read = await readChat(
        request,
        url.pathname,
        chat,
        this.runtime,
        this.source,
        this.ledger,
        (entry, index) => this.imageCalls.hasAssistantFiles(entry, index),
      );
      if (read !== null) return read;
      const skills = await conversationSkillsEndpoint({
        request,
        pathname: url.pathname,
        owners: this.owners,
        chat,
        recovery: this.skillRecovery,
      });
      if (skills !== null) return skills;
      if (request.method === "POST" && url.pathname === "/title") {
        const body = decodeOption(ConversationTitleBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        return json({ first: await this.runtime.firstAcceptedInput(body.operationId) });
      }
      if (request.method === "POST" && url.pathname === "/messages") {
        const body = decodeOption(ConversationSendBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        const ownerId = request.headers.get("x-chat-owner");
        if (ownerId === null || ownerId.length === 0 || ownerId.length > 256)
          return json({ message: "Missing owner identity" }, 400);
        if (!this.owners.bind(ownerId, Date.now()))
          return json({ message: "Owner identity does not match this conversation." }, 400);
        const applicationOrigin = conversationApplicationOrigin(request);
        if (applicationOrigin === null) return json({ message: "Missing application origin" }, 400);
        const officeSession = chatOfficeSessionFromRequest(request, ownerId);
        return await this.submission.send(body, {
          chat,
          ownerId,
          applicationOrigin,
          ...(officeSession === null ? {} : { officeSession }),
        });
      }
      if (request.method === "POST" && url.pathname === "/stop") {
        const body = decodeOption(ConversationStopBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        return await this.stop(body.operationId);
      }
      return json({ message: "Not found" }, 404);
    } catch (error) {
      if (error instanceof RefreshFence) return json({ message: "Refresh required" }, 409);
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
  }
}
