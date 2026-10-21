/**
 * Exact frozen-action receipts. Every uncertain HTTP/parse/transport result is
 * recovered from the same command receipt, never called "nothing changed".
 * Cancellation propagates before dispatch, after awaits and during recovery.
 */
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { decodeOption } from "./chat-internal.ts";
import {
  abortIfRequested,
  AccountCallUncertain,
  catalogCall,
  toolResult,
  unavailable,
  type AccountToolAccess,
} from "./chat-account-tool-kit.ts";
import {
  ActionReceiptResponse,
  ThemeCommandResponse,
  fingerprintOf,
  type ActionReceipt,
  type ThemeCommand,
} from "./theme-model.ts";
import type { ToolContext } from "./chat-account-resolver.ts";

const report = (receipt: ActionReceipt, recovered = false): ToolExecutionResult => {
  const result = receipt.result;
  const history = recovered
    ? {
        replayed: true,
        note: "This is the recorded result of the original action, not a new change or a guarantee of today's appearance.",
      }
    : {};
  if (result.ok)
    return toolResult({
      ok: true,
      code: result.code,
      changed: result.changed,
      theme: result.theme,
      previousTheme: receipt.before.theme,
      revision: result.revision,
      actionId: receipt.actionId,
      ...history,
      ...(result.code === "unchanged"
        ? {
            message:
              "That theme was already selected, so no visual change or new Undo step was recorded.",
          }
        : {}),
    });
  return toolResult(
    {
      ok: false,
      code: result.code,
      currentTheme: result.currentTheme,
      currentRevision: result.currentRevision,
      actionId: receipt.actionId,
      message: result.message,
      ...history,
    },
    true,
  );
};

const matches = (receipt: ActionReceipt, origin: string, command: ThemeCommand): boolean =>
  receipt.actionId === command.actionId &&
  receipt.origin === origin &&
  receipt.fingerprint === fingerprintOf(command);

const receiptFor = async (
  access: AccountToolAccess,
  context: ToolContext,
  ownerId: string,
  origin: string,
  command: ThemeCommand,
): Promise<ActionReceipt | null> => {
  const response = await catalogCall(
    access,
    ownerId,
    "GET",
    `/theme/receipt?actionId=${encodeURIComponent(command.actionId)}`,
    undefined,
    undefined,
    context,
  );
  const receipt =
    response.status === 200
      ? (decodeOption(ActionReceiptResponse, response.body)?.receipt ?? null)
      : null;
  return receipt !== null && matches(receipt, origin, command) ? receipt : null;
};

export const dispatchThemeCommand = async (
  access: AccountToolAccess,
  context: ToolContext,
  ownerId: string,
  /** Exact executing native operation for skills health; never the frozen action id. */
  executingOperationId: string,
  command: ThemeCommand,
  path: string,
  body: { readonly origin: string; readonly command: ThemeCommand },
): Promise<ToolExecutionResult> => {
  abortIfRequested(context);
  // An existing exact receipt is the recorded original result: report it as
  // historical instead of re-applying under a new turn.
  try {
    const existing = await receiptFor(access, context, ownerId, body.origin, command);
    if (existing !== null) return report(existing, true);
  } catch (error) {
    if (!(error instanceof AccountCallUncertain)) throw error;
  }
  abortIfRequested(context);
  // Exact proven operation only; a latched or corrupt skill state stops the
  // mutation before any catalog write.
  try {
    await access.dispatchGate(executingOperationId);
  } catch (error) {
    return unavailable(
      error instanceof Error ? error.message : "The skill state for this request is unavailable.",
    );
  }
  abortIfRequested(context);
  const blocked = access.dispatchFence(executingOperationId);
  if (blocked !== null) return unavailable(blocked);
  try {
    const response = await catalogCall(access, ownerId, "POST", path, body, undefined, context);
    const decoded =
      response.status === 200 ? decodeOption(ThemeCommandResponse, response.body) : null;
    if (decoded !== null && matches(decoded.receipt, body.origin, command))
      return report(decoded.receipt);
  } catch (error) {
    if (!(error instanceof AccountCallUncertain)) throw error;
  }
  abortIfRequested(context);
  let recovered: ActionReceipt | null = null;
  try {
    recovered = await receiptFor(access, context, ownerId, body.origin, command);
  } catch (error) {
    abortIfRequested(context);
    if (!(error instanceof AccountCallUncertain)) throw error;
  }
  abortIfRequested(context);
  if (recovered !== null) return report(recovered, true);
  return toolResult(
    {
      ok: false,
      code: "outcome_unknown",
      message:
        "I could not confirm whether that theme change was saved. It may already be applied; check Appearance before asking again.",
    },
    true,
  );
};
