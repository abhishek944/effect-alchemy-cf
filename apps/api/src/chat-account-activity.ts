import {
  ConversationActivity,
  unknownChatActivity,
  type ChatActivity,
} from "@highchat/chat-contract/gateway-usage";
import { type Context, Effect } from "effect";
import { type ChatNamespaces, doCall } from "./chat-bindings.ts";
import { chatHeader, ChatListResponse, decodeOrFail } from "./chat-internal.ts";
import { ChatUnavailable } from "./chat-model.ts";

/** CurrentUser owns both catalogue enumeration and every stage-local conversation address. */
export const readAccountActivity = Effect.fnUntraced(
  function* (
    ns: Context.Service.Shape<typeof ChatNamespaces>,
    ownerId: string,
    period: { readonly start: string; readonly end: string },
  ): Effect.fn.Return<ChatActivity, ChatUnavailable> {
    const listed = yield* doCall(ns.catalog(ownerId), "GET", "/list");
    if (listed.status !== 200) return yield* Effect.fail(new ChatUnavailable());
    const { chats } = yield* decodeOrFail(ChatListResponse, listed.body);
    let total = 0;
    const daily = new Map<string, number>();
    // Sequential reads avoid unbounded fan-out without introducing a new capacity policy.
    for (const chat of chats) {
      const call = yield* doCall(
        ns.conversation(ownerId, chat.id),
        "GET",
        `/activity?${new URLSearchParams(period)}`,
        undefined,
        chatHeader(chat),
      );
      if (call.status !== 200) return yield* Effect.fail(new ChatUnavailable());
      const activity = yield* decodeOrFail(ConversationActivity, call.body);
      if (activity.days.some((day) => day < period.start || day > period.end))
        return yield* Effect.fail(new ChatUnavailable());
      const days = new Set(activity.days);
      if (days.size > 0) total += 1;
      for (const day of days) daily.set(day, (daily.get(day) ?? 0) + 1);
    }
    return {
      source: "app",
      total,
      daily: [...daily]
        .toSorted(([a], [b]) => a.localeCompare(b))
        .map(([date, count]) => ({ date, chats: count })),
    };
  },
  // Any missing conversation makes the distinct total unknown, not a partial undercount.
  Effect.catch(() => Effect.succeed(unknownChatActivity())),
);
