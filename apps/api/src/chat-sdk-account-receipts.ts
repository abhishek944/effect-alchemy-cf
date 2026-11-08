/**
 * Exact frozen-action receipts for the real Node SDK host.
 *
 * Every uncertain HTTP/parse/transport result is recovered from the same
 * command receipt, never called "nothing changed". Cancellation propagates
 * before dispatch, after awaits and during recovery.
 */
import { reportThemeObservation } from "./chat-account-diagnostics.ts";
import {
  AccountCallUncertain,
  abortIfRequested,
  catalogCall,
  decode,
  guardOperation,
  unavailable,
  type ChatSdkAccountDeps,
  type DoCall,
} from "./chat-sdk-account-shared.ts";
import { sdkToolText, type ChatToolResult, type ChatToolScope } from "./chat-sdk-tool.ts";
import {
  ActionReceiptResponse,
  ThemeCommandResponse,
  fingerprintOf,
  type ActionReceipt,
  type ThemeCommand,
} from "./theme-model.ts";

const report = (receipt: ActionReceipt, recovered = false): ChatToolResult => {
  const result = receipt.result;
  const history = recovered
    ? {
        replayed: true,
        note: "This is the recorded result of the original action, not a new change or a guarantee of today's appearance.",
      }
    : {};
  if (result.ok)
    return sdkToolText({
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
  return sdkToolText(
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
  deps: ChatSdkAccountDeps,
  scope: ChatToolScope,
  ownerId: string,
  origin: string,
  command: ThemeCommand,
): Promise<ActionReceipt | null> => {
  const response = await catalogCall(
    deps,
    scope,
    ownerId,
    "GET",
    `/theme/receipt?actionId=${encodeURIComponent(command.actionId)}`,
  );
  const receipt =
    response.status === 200
      ? (decode(ActionReceiptResponse, response.body)?.receipt ?? null)
      : null;
  return receipt !== null && matches(receipt, origin, command) ? receipt : null;
};

export const dispatchThemeCommand = async (
  deps: ChatSdkAccountDeps,
  scope: ChatToolScope,
  ownerId: string,
  command: ThemeCommand,
  path: string,
  body: { readonly origin: string; readonly command: ThemeCommand },
): Promise<ChatToolResult> => {
  abortIfRequested(scope);
  let observation: unknown;
  let dispatch: unknown;
  let recovery: unknown;
  let dispatchStatus: number | undefined;
  // An existing exact receipt is the recorded original result: report it as
  // historical instead of re-applying under a new turn.
  try {
    const existing = await receiptFor(deps, scope, ownerId, body.origin, command);
    if (existing !== null) return report(existing, true);
  } catch (error) {
    if (!(error instanceof AccountCallUncertain)) throw error;
    observation = error;
  }
  abortIfRequested(scope);
  // Exact proven operation only; a latched or corrupt skill state stops the
  // mutation before any catalog write.
  const blocked = await guardOperation(deps, scope.operationId);
  if (blocked !== null) return unavailable(blocked);
  abortIfRequested(scope);
  let dispatchCall: DoCall | null = null;
  try {
    dispatchCall = await catalogCall(deps, scope, ownerId, "POST", path, body);
    dispatchStatus = dispatchCall.status;
    const decoded =
      dispatchCall.status === 200 ? decode(ThemeCommandResponse, dispatchCall.body) : null;
    if (decoded !== null && matches(decoded.receipt, body.origin, command)) {
      if (observation !== undefined)
        reportThemeObservation(
          observation,
          scope.operationId,
          command.actionId,
          "receipt-lookup",
          "confirmed",
        );
      return report(decoded.receipt);
    }
  } catch (error) {
    if (!(error instanceof AccountCallUncertain)) throw error;
    dispatch = error;
  }
  abortIfRequested(scope);
  let recovered: ActionReceipt | null = null;
  try {
    recovered = await receiptFor(deps, scope, ownerId, body.origin, command);
  } catch (error) {
    abortIfRequested(scope);
    if (!(error instanceof AccountCallUncertain)) throw error;
    recovery = error;
  }
  abortIfRequested(scope);
  const causes = [dispatch, observation, recovery].filter((item) => item !== undefined);
  const cause = causes.length > 1 ? new AggregateError(causes) : causes[0];
  if (recovered !== null) {
    reportThemeObservation(
      cause,
      scope.operationId,
      command.actionId,
      "dispatch",
      "confirmed",
      dispatchStatus,
    );
    return report(recovered, true);
  }
  reportThemeObservation(
    cause,
    scope.operationId,
    command.actionId,
    "receipt-recovery",
    "unknown",
    dispatchStatus,
  );
  return sdkToolText(
    {
      ok: false,
      code: "outcome_unknown",
      message:
        "I could not confirm whether that theme change was saved. It may already be applied; check Appearance before asking again.",
    },
    true,
  );
};
