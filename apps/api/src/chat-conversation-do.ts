import { ChatObject } from "./chat-object.ts";
import type { ChatObjectContext } from "./chat-object.ts";
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
import { streamChat } from "./chat-sse.ts";
import { SUBMISSION_FAILED } from "./chat-model.ts";
import * as observation from "./chat-observation.ts";
import { conversationApplicationOrigin } from "./chat-public-origin.ts";
import { conversationUsage } from "./chat-usage-http.ts";
import {
  createChatConversationServices,
  type ChatConversationServices,
  type SkillConversationEnv,
} from "./chat-conversation-services.ts";

/** Private storage and authorization actor. Agent execution lives only in the Node Pi SDK host. */
export class ChatConversation extends ChatObject<SkillConversationEnv> {
  private readonly services: ChatConversationServices;
  private readonly imageCatalog;
  constructor(ctx: ChatObjectContext, env: SkillConversationEnv) {
    super(ctx, env);
    this.services = createChatConversationServices(ctx, env);
    this.services.runtime.diagnostic = observation.chatObjectMetadata(env);
    this.imageCatalog = () => {
      const owner = conversationOwner(ctx.id.name);
      if (owner === null || this.services.owners.owner() !== owner)
        throw new Error("Image owner binding is unavailable");
      return conversationCatalogStub(env, owner);
    };
  }
  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let stopped: string | null = null;
    const chat = chatFromHeader(request.headers.get("x-chat-json"));
    if (chat === null) return json({ message: "Missing chat identity" }, 400);
    const { runtime, accounting, source, imageCalls, ledger, skills, owners, submission } =
      this.services;
    try {
      const usage = await conversationUsage(
        request,
        chat,
        runtime,
        accounting,
        this.services.estimateMessages,
      );
      if (usage !== null) return usage;
      const images = await readConversationImages({
        request,
        chat,
        runtime,
        calls: imageCalls,
        catalog: this.imageCatalog,
      });
      if (images !== null) return images;
      if (request.method === "GET" && url.pathname === "/events") {
        await source.initialize();
        return streamChat(
          {
            current: () => source.snapshot(chat),
            subscribe: (invalidate) => source.subscribe(invalidate),
          },
          request.signal,
          observation.chatEventContext(request, chat.id, runtime.diagnostic),
        );
      }
      if (request.method === "GET" && url.pathname === "/snapshot")
        return json(await source.snapshot(chat));
      const read = await readChat(
        request,
        url.pathname,
        chat,
        runtime,
        source,
        ledger,
        (entry, index) => imageCalls.hasAssistantFiles(entry, index),
      );
      if (read !== null) return read;
      if (url.pathname.startsWith("/skills/")) {
        const ownerId = request.headers.get("x-chat-owner");
        if (ownerId === null || !owners.bind(ownerId, Date.now()))
          return json({ message: "Missing owner identity" }, 400);
        if (request.method === "GET" && url.pathname === "/skills/readiness")
          return json(await skills.readiness(ownerId));
        if (
          request.method === "POST" &&
          ["/skills/retry", "/skills/new-send"].includes(url.pathname)
        )
          return json(
            {
              message:
                "Checkpoint recovery is no longer supported. Send a new message with the current Skills library.",
              code: "skills_recovery_unavailable",
            },
            409,
          );
      }
      if (request.method === "POST" && url.pathname === "/title") {
        const body = decodeOption(ConversationTitleBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        return json({ first: await runtime.firstAcceptedInput(body.operationId) });
      }
      if (request.method === "POST" && url.pathname === "/messages") {
        const body = decodeOption(ConversationSendBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        const ownerId = request.headers.get("x-chat-owner");
        if (ownerId === null || !owners.bind(ownerId, Date.now()))
          return json({ message: "Missing or mismatched owner identity" }, 400);
        const applicationOrigin = conversationApplicationOrigin(request);
        if (applicationOrigin === null) return json({ message: "Missing application origin" }, 400);
        return await submission.send(
          body,
          { chat, ownerId, applicationOrigin },
          observation.chatRequestObservation(request),
        );
      }
      if (request.method === "POST" && url.pathname === "/stop") {
        const body = decodeOption(ConversationStopBody, await requestBody(request));
        if (body === null) return json({ message: "Invalid request" }, 400);
        stopped = body.operationId;
        await runtime.stop(body.operationId);
        return json({ ok: true });
      }
      return json({ message: "Not found" }, 404);
    } catch (error) {
      if (error instanceof RefreshFence) return json({ message: "Refresh required" }, 409);
      observation.reportObjectFailure(
        error,
        "conversation",
        request,
        chat.id,
        runtime.diagnostic,
        stopped === null ? undefined : { phase: "sdk-stop", operationId: stopped },
      );
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
  }
}
