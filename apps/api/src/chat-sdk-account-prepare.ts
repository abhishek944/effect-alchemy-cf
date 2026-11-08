/**
 * Immutable account candidate for one accepted send.
 *
 * Preparation happens before admission: a theme read freezes the expected
 * revision and any Undo target so execution never rebases from a later read. An
 * unreachable catalog produces an honest `unavailable` intent instead of a guess.
 */
import { reportFailure } from "@highchat/diagnostics";
import { parseThemeCommand } from "./chat-account-intent.ts";
import type { AccountOperationRecord } from "./chat-account-operations.ts";
import {
  decode,
  digestText,
  type AccountPrepareScope,
  type ChatSdkAccountDeps,
  type DoCall,
} from "./chat-sdk-account-shared.ts";
import { ThemeResponse, UndoTargetResponse, type FrozenIntent } from "./theme-model.ts";

const prepareRead = async (
  deps: ChatSdkAccountDeps,
  ownerId: string,
  path: string,
  operationId: string,
  chatId: string,
  headers?: Record<string, string>,
): Promise<DoCall | null> => {
  try {
    const response = await deps.catalog(ownerId).fetch(`https://chat.internal${path}`, {
      method: "GET",
      headers: { "content-type": "application/json", ...headers },
    });
    const text = await response.text();
    let body: unknown = null;
    if (text.length > 0) {
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
    }
    return { status: response.status, body };
  } catch (error) {
    reportFailure(error, {
      component: "chat-account",
      operation: "theme.prepare",
      phase: "read",
      reason: "theme_read_failed",
      operationId,
      chatId,
      event: "application.recovery",
    });
    return null;
  }
};

/**
 * Prepares the immutable account candidate for one send. An ordinary message
 * carries a `none` intent; a theme-ish message either freezes an apply/undo or
 * records an honest `unavailable` reason.
 */
export const prepareAccount = async (
  deps: ChatSdkAccountDeps,
  input: { readonly text: string; readonly operationId: string },
  scope: AccountPrepareScope,
): Promise<AccountOperationRecord | null> => {
  const parsed = parseThemeCommand(input.text);
  const base = {
    version: 1 as const,
    ownerId: scope.ownerId,
    chatScope: deps.chatScope(),
    conversationId: await deps.conversationId(),
  };
  const failure = (message: string): AccountOperationRecord => ({
    ...base,
    intent: { kind: "unavailable", message } satisfies FrozenIntent,
  });
  if (parsed.kind === "none") return { ...base, intent: { kind: "none" } };
  if (parsed.kind === "unavailable")
    return { ...base, intent: { kind: "unavailable", message: parsed.message } };
  const origin = `${base.chatScope}:${base.conversationId}`;
  const actionId = `acct:${(await digestText(`v1|${origin}|${input.operationId}|${parsed.kind}`)).slice(0, 40)}`;
  if (parsed.kind === "apply") {
    const response = await prepareRead(
      deps,
      scope.ownerId,
      "/theme",
      input.operationId,
      scope.chat.id,
    );
    const view = response === null ? null : (decode(ThemeResponse, response.body)?.theme ?? null);
    if (view === null)
      return failure(
        "The saved theme could not be read, so I did not prepare a change. Ask again.",
      );
    return {
      ...base,
      intent: {
        kind: "apply",
        actionId,
        operationId: input.operationId,
        theme: parsed.theme,
        expectedRevision: view.revision,
      },
    };
  }
  const response = await prepareRead(
    deps,
    scope.ownerId,
    "/theme/undo-target",
    input.operationId,
    scope.chat.id,
    { "x-theme-origin": encodeURIComponent(origin) },
  );
  const target =
    response === null ? null : (decode(UndoTargetResponse, response.body)?.target ?? null);
  if (target === null) return failure("There is no theme change from this chat left to undo.");
  return {
    ...base,
    intent: {
      kind: "undo",
      actionId,
      operationId: input.operationId,
      targetActionId: target.targetActionId,
      expectedRevision: target.expectedRevision,
    },
  };
};
