/**
 * Catalog admission closures for the recovery service.
 *
 * These keep the conversation services module small while preserving the exact
 * existing wire calls: quota admission with a fresh lease token, release of that
 * exact lease, and finalize/touch after acceptance.
 */
import { AdmitDecision, decodeOption } from "./chat-internal.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { conversationCatalogPost } from "./chat-conversation-catalog.ts";

export const conversationRecoveryAdmission = (env: ConversationFileEnv) => ({
  admit: async (input: {
    readonly ownerId: string;
    readonly chatId: string;
    readonly operationId: string;
    readonly identity: string;
    readonly leaseId: string;
    readonly now: number;
  }) => {
    const raw = await conversationCatalogPost(env, input.ownerId, "/admit", {
      operationId: input.operationId,
      chatId: input.chatId,
      identity: input.identity,
      now: input.now,
      nativeAccepted: false,
      attemptId: input.leaseId,
    });
    const decision = decodeOption(AdmitDecision, raw);
    if (decision === null)
      throw new Error("Private chat catalog returned an invalid admission decision");
    return decision;
  },
  releaseAdmission: (operationId: string, leaseId: string, ownerId: string) =>
    conversationCatalogPost(env, ownerId, "/release", {
      operationId,
      attemptId: leaseId,
    }).then(() => undefined),
  finalize: async (operationId: string, chatId: string, ownerId: string) => {
    await conversationCatalogPost(env, ownerId, "/finalize", { operationId, now: Date.now() });
    await conversationCatalogPost(env, ownerId, "/touch", { id: chatId });
  },
});
