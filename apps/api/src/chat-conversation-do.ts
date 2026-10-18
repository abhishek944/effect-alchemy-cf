import type { Ai } from "@cloudflare/workers-types";
import type * as cf from "@cloudflare/workers-types";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness, type Storage } from "@earendil-works/pi-durable";
import { Agent, type AgentContext } from "agents";
import { PiHarness } from "agents/harness/pi";
import { createAI } from "agents/models/pi-ai";
import {
  ConversationSendBody,
  ConversationStopBody,
  ConversationTitleBody,
  chatFromHeader,
  decodeOption,
  json,
  requestBody,
} from "./chat-internal.ts";
import { ChatLedger } from "./chat-ledger.ts";
import { CHAT_MODEL, SUBMISSION_FAILED } from "./chat-model.ts";
import { readChat } from "./chat-reads.ts";
import { ChatSource, RefreshFence } from "./chat-source.ts";
import { ChatRuntime } from "./chat-runtime.ts";
import { streamChat } from "./chat-sse.ts";
import { ChatSubmission } from "./chat-submission.ts";
import { ChatAccounting } from "./chat-accounting.ts";
import { accountTools } from "./chat-account-tools.ts";
import {
  accountToolAccess,
  prepareAccountOperation,
  type AccountPreparationDeps,
} from "./chat-account-preparation.ts";
import { ChatOwnerBinding } from "./chat-tool-authorization.ts";
import { conversationUsage } from "./chat-usage-http.ts";
import { ChatSendRecords } from "./chat-send-records.ts";
import { configuredChatPolicy } from "./chat-preferences-http.ts";
import {
  prepareConversationFiles,
  retainConversationFiles,
  releaseConversationFiles,
  type ConversationFileEnv,
} from "./chat-conversation-files.ts";

type ChatEnv = ConversationFileEnv & {
  AI?: Ai;
  CHAT_GATEWAY_ID?: string;
  CHAT_MODEL_ALLOWLIST?: string;
};

/**
 * One private conversation per owner and public chat id. Pi owns the
 * transcript and the run; this object projects snapshots, resolves public
 * operation identity from native submission records, and relays submission,
 * targeted cancellation and event attachment.
 */
export class ChatConversation extends Agent<ChatEnv> {
  private readonly harness: PiHarness;
  private readonly ledger: ChatLedger;
  private readonly runtime: ChatRuntime;
  private readonly submission: ChatSubmission;
  private readonly source: ChatSource;
  private readonly accounting: ChatAccounting;
  private readonly owners: ChatOwnerBinding;
  private readonly records: ChatSendRecords;
  private readonly account: AccountPreparationDeps;
  private toolStorageRef: Storage | null = null;

  constructor(ctx: AgentContext, env: ChatEnv) {
    super(ctx, env);
    const gatewayId =
      typeof env.CHAT_GATEWAY_ID === "string" && env.CHAT_GATEWAY_ID.length > 0
        ? env.CHAT_GATEWAY_ID
        : null;
    const ai =
      gatewayId !== null && env.AI !== undefined
        ? createAI({ binding: env.AI, id: gatewayId })
        : null;
    const records = new ChatSendRecords(ctx.storage.sql);
    this.records = records;
    this.ledger = new ChatLedger(ctx.storage.sql);
    this.owners = new ChatOwnerBinding(ctx.storage);
    this.accounting = new ChatAccounting(ctx.storage.sql, () => this.source.invalidateUsage());
    this.account = {
      owners: this.owners,
      chatName: () => this.ctx.id.name,
      chatScope: () => this.ctx.id.toString(),
      conversationId: async () => String(await this.runtime.conversationId()),
      accountOperation: (operationId) => this.records.account(operationId),
      catalog: (ownerId) => this.catalogStub(ownerId),
      storage: () => {
        if (this.toolStorageRef === null)
          throw new Error("Account tools require an open harness storage");
        return this.toolStorageRef;
      },
    };
    this.harness = new PiHarness({
      harness: async ({ storage, context }) => {
        const models = createModels();
        if (ai !== null) models.setProvider(ai.provider);
        this.accounting.observeCompactions(models);
        this.toolStorageRef = storage;
        const tools = accountTools(accountToolAccess(this.account));
        const registry = createRegistry();
        registry.install(this.accounting.extension(() => this.runtime.selection()));
        registry.install(tools);
        return Harness.open(storage, { models, registry }, context);
      },
      defaults: { model: CHAT_MODEL, thinkingLevel: "high" },
    });
    this.runtime = new ChatRuntime(this.harness, this.ledger, records);
    this.submission = new ChatSubmission({
      harness: this.harness,
      runtime: this.runtime,
      ledger: this.ledger,
      records,
      enabled: ai !== null,
      policy: configuredChatPolicy(env.CHAT_MODEL_ALLOWLIST),
      prepare: (input, scope, model) => prepareConversationFiles(env, input, scope, model),
      prepareAccount: (input, scope) => prepareAccountOperation(this.account, input, scope),
      retain: (input, scope) => retainConversationFiles(env, input, scope),
      release: (input, scope) => releaseConversationFiles(env, input, scope),
    });
    this.source = new ChatSource(this.runtime);
    this.lifecycle.use(this.harness);
  }

  private catalogStub(ownerId: string): cf.DurableObjectStub {
    const namespace = this.env.ChatCatalog;
    if (namespace === undefined) throw new Error("Missing chat catalog binding");
    return namespace.getByName(`owner:${ownerId}`);
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
    const chat = chatFromHeader(request.headers.get("x-chat-json"));
    if (chat === null) return json({ message: "Missing chat identity" }, 400);
    try {
      const usage = await conversationUsage(request, chat, this.runtime, this.accounting);
      if (usage !== null) return usage;
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
      );
      if (read !== null) return read;
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
        return await this.submission.send(body, { chat, ownerId });
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
