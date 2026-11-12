import { createHmac } from "node:crypto";

/** Verified Clerk owner passes through unchanged; only per-chat correlation is HMAC-derived. */
export const chatIdentity = (
  env: Readonly<Record<string, unknown>>,
  ownerId: string | null | undefined,
  chatId: string,
): { userId: string; sessionId: string } => {
  const secret = env.CHAT_IDENTITY_SECRET;
  const stage = env.APP_STAGE ?? "dev";
  if (
    typeof secret !== "string" ||
    !secret.trim() ||
    (stage !== "dev" && stage !== "prod") ||
    !ownerId?.trim() ||
    !chatId.trim()
  )
    throw new Error("Chat attribution unavailable");
  const opaque = (kind: string, value: string) =>
    `${stage}_${createHmac("sha256", secret)
      .update(JSON.stringify([stage, kind, value]))
      .digest("hex")}`;
  return { userId: ownerId, sessionId: opaque("chat", `${ownerId}:${chatId}`) };
};

/** Attribution is applied last, after all model/host options, never accepted from their payload. */
export const attributedPayload = (payload: unknown, customer: string, api: string): unknown => {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Invalid chat model payload");
  // The same verified Clerk UID is used on the gateway and provider wire, without rewriting.
  return api === "anthropic-messages" ? payload : { ...payload, user: customer };
};
