import type * as cf from "@cloudflare/workers-types";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";

export const conversationCatalogStub = (
  env: ConversationFileEnv,
  ownerId: string,
): cf.DurableObjectStub => {
  if (env.ChatCatalog === undefined) throw new Error("Missing chat catalog binding");
  return env.ChatCatalog.getByName(`owner:${ownerId}`);
};

/** Trusted owner-scoped metadata transport; an uncertain mutation is not retried. */
export const conversationCatalogPost = async (
  env: ConversationFileEnv,
  ownerId: string,
  path: string,
  body: unknown,
): Promise<unknown> => {
  try {
    const response = await conversationCatalogStub(env, ownerId).fetch(
      `https://chat.internal${path}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return response.status === 200 ? await response.json() : null;
  } catch {
    return null;
  }
};
