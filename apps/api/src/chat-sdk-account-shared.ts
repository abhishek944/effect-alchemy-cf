/**
 * Shared account-tool plumbing for the real Node SDK host.
 *
 * The Worker proves the live assistant tool call and supplies ChatToolScope, so
 * nothing here reads a transcript, model prose or a model-supplied owner. The
 * frozen command record is joined to that object-selected scope, and every
 * catalog call keeps the catalog's at-most-once receipts authoritative.
 */
import type * as cf from "./platform.ts";
import { Option, Schema } from "effect";
import type { AccountOperationView } from "./chat-account-operations.ts";
import { conversationOwner } from "./chat-tool-authorization.ts";
import type { FrozenIntent } from "./theme-model.ts";
import { sdkToolText, type ChatToolResult, type ChatToolScope } from "./chat-sdk-tool.ts";

export type ChatSdkAccountDeps = {
  readonly chatName: () => string | undefined;
  readonly chatScope: () => string;
  /** Durable conversation owner binding; never derived from a model argument. */
  readonly owners: { readonly owner: () => string | null };
  readonly conversationId: () => Promise<string>;
  readonly accountOperation: (operationId: string) => AccountOperationView | null;
  readonly catalog: (ownerId: string) => cf.DurableObjectStub;
  /** Parent-owned precondition for the exact operation, e.g. prepared Skills health. */
  readonly operationGuard?: (operationId: string) => Promise<string | null>;
};

export type AccountPrepareScope = {
  readonly ownerId: string;
  readonly chat: { readonly id: string };
};

export type DoCall = { readonly status: number; readonly body: unknown };

/** Transport failure or cancellation after dispatch: the outcome is unknown. */
export class AccountCallUncertain extends Error {
  constructor(message = "The account service could not be reached.") {
    super(message);
    this.name = "AccountCallUncertain";
  }
}

export const decode = <S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  input: unknown,
): S["Type"] | null => Option.getOrNull(Schema.decodeUnknownOption(schema)(input));

export const unavailable = (message: string): ChatToolResult =>
  sdkToolText({ ok: false, code: "unavailable", message }, true);

export const abortIfRequested = (scope: ChatToolScope): void => scope.signal.throwIfAborted();

/** Owner is the server-assigned object name, confirmed against the durable binding. */
export const boundOwner = (deps: ChatSdkAccountDeps): string | null => {
  const derived = conversationOwner(deps.chatName());
  return derived !== null && deps.owners.owner() === derived ? derived : null;
};

const digestText = async (text: string): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

const isWorkerSignal = (value: unknown): value is cf.AbortSignal => value instanceof AbortSignal;

/** Raw internal catalog call; a malformed successful reply is a failure, never absence. */
export const catalogCall = async (
  deps: ChatSdkAccountDeps,
  scope: ChatToolScope,
  ownerId: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<DoCall> => {
  abortIfRequested(scope);
  try {
    const signal = scope.signal;
    if (!isWorkerSignal(signal)) throw new AccountCallUncertain();
    const response = await deps.catalog(ownerId).fetch(`https://chat.internal${path}`, {
      method,
      signal,
      headers: { "content-type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    abortIfRequested(scope);
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch (error) {
        if (response.ok) throw error;
      }
    }
    return { status: response.status, body: parsed };
  } catch (error) {
    abortIfRequested(scope);
    throw error instanceof AccountCallUncertain ? error : new AccountCallUncertain();
  }
};

export type ResolvedAccountOperation = {
  readonly operationId: string;
  readonly ownerId: string;
  readonly chatScope: string;
  readonly conversationId: string;
  readonly identityHash: string;
  readonly intent: FrozenIntent;
};

export type ResolveResult =
  | { readonly ok: true; readonly value: ResolvedAccountOperation }
  | { readonly ok: false; readonly message: string };

const refuse = (message: string): ResolveResult => ({ ok: false, message });

/**
 * Joins the Worker-proven operation scope to the frozen host record. Any missing
 * or mismatched step fails closed before the tool performs an account write.
 */
export const resolveAccountOperation = (
  deps: ChatSdkAccountDeps,
  scope: ChatToolScope,
): ResolveResult => {
  abortIfRequested(scope);
  const ownerId = boundOwner(deps);
  if (ownerId === null || ownerId !== scope.ownerId)
    return refuse("The signed-in owner of this chat could not be confirmed.");
  const host = deps.accountOperation(scope.operationId);
  if (host === null)
    return refuse("This request has no frozen account command, so nothing was changed.");
  const chatScope = deps.chatScope();
  if (
    host.ownerId !== ownerId ||
    host.chatScope !== chatScope ||
    host.chatScope !== scope.chatScope
  )
    return refuse("This account request belongs to a different chat scope.");
  if (host.conversationId !== scope.conversationId)
    return refuse("This account request belongs to a different conversation.");
  return {
    ok: true,
    value: {
      operationId: host.operationId,
      ownerId,
      chatScope,
      conversationId: host.conversationId,
      identityHash: host.identityHash,
      intent: host.intent,
    },
  };
};

/** Parent-owned health gate; a thrown error becomes an honest unavailable message. */
export const guardOperation = async (
  deps: ChatSdkAccountDeps,
  operationId: string,
): Promise<string | null> => {
  if (deps.operationGuard === undefined) return null;
  try {
    return await deps.operationGuard(operationId);
  } catch (error) {
    return error instanceof Error
      ? error.message
      : "The skill state for this request is unavailable.";
  }
};

export { digestText };
