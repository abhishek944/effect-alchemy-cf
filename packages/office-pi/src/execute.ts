import { Effect } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import type { OfficeCommand } from "@starter/office-contract";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { checkReceipt, dispatch, receiptKind } from "./dispatch.ts";
import { bindIntent, claimDispatch, hasOperation } from "./intent.ts";
import { OfficeToolRequest } from "./parameters.ts";
import { failedResult, failureCode, outputResult } from "./results.ts";
import type { OfficePiHost, OfficeTaskAccess, OfficeToolContext } from "./types.ts";

const observe = async (
  command: OfficeCommand,
  operationId: string,
  access: OfficeTaskAccess,
  context: OfficeToolContext,
): Promise<ToolExecutionResult> => {
  if (receiptKind(command) === null) return failedResult("OUTCOME_UNKNOWN", operationId);
  try {
    const raw = await Effect.runPromise(
      access.client.receipt({ params: { operationId } }),
      context.abortSignal === undefined ? {} : { signal: context.abortSignal },
    );
    context.abortSignal?.throwIfAborted();
    const receipt = checkReceipt(raw, operationId, receiptKind(command));
    return outputResult(command.command, operationId, { kind: "receipt", value: receipt }, true);
  } catch {
    context.abortSignal?.throwIfAborted();
    // Missing/unavailable/mismatched evidence is uncertainty, NEVER redispatch permission.
    return failedResult("OUTCOME_UNKNOWN", operationId);
  }
};

export const executeOfficeTool = async (
  raw: unknown,
  api: ToolExecutionApi,
  context: OfficeToolContext,
  host: OfficePiHost,
): Promise<ToolExecutionResult> => {
  context.abortSignal?.throwIfAborted();
  let command: OfficeCommand;
  try {
    command = decodeWireSync(OfficeToolRequest)(raw).request;
  } catch {
    return failedResult("INVALID_INPUT", null);
  }
  let operationId: string | null = command.command === "operation" ? command.operationId : null;
  let access: OfficeTaskAccess | null = null;
  let dispatched = false;
  try {
    const binding = await bindIntent(command, api, context);
    command = binding.command;
    if (hasOperation(command)) operationId = binding.intent.operationId;
    access = await host.resolve({ api, context, intent: binding.intent });
    context.abortSignal?.throwIfAborted();
    if (hasOperation(command)) {
      await api.details({ command: command.command, operationId }, context);
      const ownsDispatch = await claimDispatch(binding.intent, api, context);
      context.abortSignal?.throwIfAborted();
      if (!ownsDispatch) return observe(command, binding.intent.operationId, access, context);
      dispatched = true;
    }
    const output = await dispatch(command, access, context.abortSignal);
    context.abortSignal?.throwIfAborted();
    return outputResult(command.command, operationId, output);
  } catch (error) {
    context.abortSignal?.throwIfAborted();
    if (dispatched && access !== null && operationId !== null)
      return observe(command, operationId, access, context);
    return failedResult(failureCode(error), operationId);
  }
};
