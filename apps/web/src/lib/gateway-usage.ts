import { Option, Schema } from "effect";
import { AccountUsage } from "@highchat/chat-contract/gateway-usage";
import { requestDecoded } from "./chat-api";
export type { AccountUsage as GatewayUsage } from "@highchat/chat-contract/gateway-usage";
export type { UsageMetrics, UsageRow } from "@highchat/chat-contract/gateway-usage";

export const getGatewayUsage = (period: { start: string; end: string }, signal: AbortSignal) =>
  requestDecoded(
    `/api/chat/usage?${new URLSearchParams(period)}`,
    "chat.account-usage",
    (body) => Option.getOrNull(Schema.decodeUnknownOption(AccountUsage)(body)),
    { signal },
  );
