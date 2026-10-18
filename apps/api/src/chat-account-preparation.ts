/**
 * Account preparation and tool access for one conversation object.
 *
 * Keeps the conversation object small: it supplies identity, scope, storage and
 * catalog access, and this module derives the frozen per-operation candidate before
 * native admission and the resolver access object the account tools use. Theme
 * reads here are best-effort preparation only; nothing mutates the account, and an
 * unreachable catalog produces an honest `unavailable` intent instead of a guess.
 */
import type { Storage } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { doCall, type ChatCatalogStub, type DoCall } from "./chat-bindings.ts";
import { conversationOwner, type ChatOwnerBinding } from "./chat-tool-authorization.ts";
import type { AccountOperationRecord, AccountOperationView } from "./chat-account-operations.ts";
import { resolveAccountOperation, type AccountAccess } from "./chat-account-resolver.ts";
import type { AccountToolAccess } from "./chat-account-tool-kit.ts";
import { parseThemeCommand } from "./chat-account-intent.ts";
import { decodeOption, digestText } from "./chat-internal.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import { ThemeResponse, UndoTargetResponse, type FrozenIntent } from "./theme-model.ts";

export type AccountPreparationDeps = {
  readonly owners: ChatOwnerBinding;
  readonly chatName: () => string | undefined;
  readonly chatScope: () => string;
  readonly conversationId: () => Promise<string>;
  readonly accountOperation: (operationId: string) => AccountOperationView | null;
  readonly catalog: (ownerId: string) => ChatCatalogStub;
  readonly storage: () => Storage;
};

/** Owner is the server-assigned object name, confirmed against the durable binding. */
export const boundOwner = (deps: AccountPreparationDeps): string | null => {
  const derived = conversationOwner(deps.chatName());
  return derived !== null && deps.owners.owner() === derived ? derived : null;
};

export const accountToolAccess = (deps: AccountPreparationDeps): AccountToolAccess => {
  const access: AccountAccess = {
    storage: deps.storage(),
    owner: () => boundOwner(deps),
    chatScope: () => deps.chatScope(),
    accountOperation: (operationId) => deps.accountOperation(operationId),
  };
  return {
    resolveOperation: (api, context) => resolveAccountOperation(api, context, access),
    catalog: (ownerId) => deps.catalog(ownerId),
  };
};

const catalogGet = async (
  deps: AccountPreparationDeps,
  ownerId: string,
  path: string,
  headers?: Record<string, string>,
): Promise<DoCall | null> => {
  try {
    return await Effect.runPromise(doCall(deps.catalog(ownerId), "GET", path, undefined, headers));
  } catch {
    return null;
  }
};

/**
 * Prepares the immutable account candidate for one send. An ordinary message
 * carries a `none` intent; a theme-ish message either freezes an apply/undo or
 * records an honest `unavailable` reason.
 */
export const prepareAccountOperation = async (
  deps: AccountPreparationDeps,
  input: { readonly text: string; readonly operationId: string },
  scope: ChatSendScope,
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
    const response = await catalogGet(deps, scope.ownerId, "/theme");
    const view =
      response === null ? null : (decodeOption(ThemeResponse, response.body)?.theme ?? null);
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
  const response = await catalogGet(deps, scope.ownerId, "/theme/undo-target", {
    "x-theme-origin": encodeURIComponent(origin),
  });
  const target =
    response === null ? null : (decodeOption(UndoTargetResponse, response.body)?.target ?? null);
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
