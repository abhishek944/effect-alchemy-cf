import { type Context, Effect, type Schema } from "effect";
import { type ChatNamespaces, doCall } from "./chat-bindings.ts";
import { ignoreReport, privateUnavailable } from "./chat-diagnostics.ts";
import { chatHeader, decodeOrFail } from "./chat-internal.ts";
import { Chat, ChatInvalid, ChatNotFound, RefreshRequired } from "./chat-model.ts";
import { CurrentUser } from "./model.ts";
import { OperationReceipt } from "./chat-contract.ts";

export const requireOwnedChat = (
  ns: Context.Service.Shape<typeof ChatNamespaces>,
  owner: string,
  id: string,
) =>
  Effect.gen(function* () {
    const lookup = yield* doCall(ns.catalog(owner), "GET", `/get?id=${encodeURIComponent(id)}`);
    if (lookup.status === 404) return yield* Effect.fail(new ChatNotFound());
    if (lookup.status !== 200)
      return yield* Effect.fail(privateUnavailable("lookup", lookup.status));
    return yield* decodeOrFail(Chat, lookup.body);
  });

/** Every read checks the owner catalog before addressing the private conversation. */
export const chatRead = <S extends Schema.Constraint>(
  ns: Context.Service.Shape<typeof ChatNamespaces>,
  id: string,
  path: string,
  payload: unknown,
  schema: S,
) =>
  Effect.gen(function* () {
    const user = yield* CurrentUser;
    const chat = yield* requireOwnedChat(ns, user.id, id);
    // Archived conversations remain readable. No owner id comes from the browser.
    const call = yield* doCall(
      ns.conversation(user.id, chat.id),
      payload === undefined ? "GET" : "POST",
      path,
      payload,
      chatHeader(chat),
    );
    if (call.status === 400)
      return yield* Effect.fail(new ChatInvalid({ message: "Invalid cursor." }));
    if (call.status === 404) return yield* Effect.fail(new ChatNotFound());
    if (call.status === 409)
      return yield* Effect.fail(new RefreshRequired({ message: "Refresh required." }));
    if (call.status !== 200) return yield* Effect.fail(privateUnavailable("read", call.status));
    if (path === "/receipt") {
      const receipt = yield* decodeOrFail(OperationReceipt, call.body);
      if (receipt.accepted)
        yield* doCall(ns.catalog(user.id), "POST", "/finalize", {
          operationId: receipt.operationId,
          now: Date.now(),
        }).pipe(
          ignoreReport({ component: "chat", operation: "read.finalize", reason: "finalize" }),
        );
    }
    return yield* decodeOrFail(schema, call.body);
  });
export const historyLimit = (raw: string | undefined): number => {
  if (raw === undefined) return 40;
  const number = Number(raw);
  return Number.isFinite(number) ? Math.min(80, Math.max(1, Math.trunc(number))) : 40;
};
