/**
 * Shared plumbing for the account chat tools.
 *
 * Tools resolve their own accepted operation (never a latest-text row) and then
 * speak to the owner catalog over the same internal channel as the API handlers.
 * A transport failure after dispatch is treated as an *uncertain* outcome rather
 * than a claimed failure, and invocation cancellation is rethrown instead of being
 * folded into an unavailable result.
 */
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { Effect } from "effect";
import { doCall, type ChatCatalogStub, type DoCall } from "./chat-bindings.ts";
import type { ResolveResult, ToolContext } from "./chat-account-resolver.ts";

export type AccountToolAccess = {
  /** Proves this tool's own accepted native input and returns its frozen intent. */
  readonly resolveOperation: (
    api: ToolExecutionApi,
    context: ToolContext,
  ) => Promise<ResolveResult>;
  readonly catalog: (ownerId: string) => ChatCatalogStub;
  /** Full async integrity check for the exact proven operation. */
  readonly dispatchGate: (operationId: string) => Promise<void>;
  /** Synchronous final known-failure fence; null means allowed. */
  readonly dispatchFence: (operationId: string) => string | null;
};

/** Transport failure or cancellation after dispatch: the outcome is unknown. */
export class AccountCallUncertain extends Error {
  constructor(message = "The account service could not be reached.") {
    super(message);
    this.name = "AccountCallUncertain";
  }
}

export const toolResult = (value: object, isError = false): ToolExecutionResult => ({
  content: [{ type: "text", text: JSON.stringify(value) }],
  isError,
});

export const unavailable = (message: string): ToolExecutionResult =>
  toolResult({ ok: false, code: "unavailable", message }, true);

/** Rethrows invocation cancellation instead of reporting a domain outcome. */
export const abortIfRequested = (context: ToolContext): void => {
  context.abortSignal?.throwIfAborted();
};

export const catalogCall = async (
  access: AccountToolAccess,
  ownerId: string,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
  context?: ToolContext,
): Promise<DoCall> => {
  if (context !== undefined) abortIfRequested(context);
  try {
    const result = await Effect.runPromise(
      doCall(access.catalog(ownerId), method, path, body, headers, context?.abortSignal),
    );
    if (context !== undefined) abortIfRequested(context);
    return result;
  } catch (error) {
    if (context !== undefined) abortIfRequested(context);
    throw new AccountCallUncertain(String(error));
  }
};
