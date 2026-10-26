import { Schema } from "effect";
import {
  Digest,
  Id,
  OfficeCommand,
  decodeWireSync,
  type DraftTarget,
} from "@starter/office-contract";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import type { OfficeToolSource } from "./parameters.ts";
import type { OfficeIntentCommand, OfficeToolContext, OfficeToolIntent } from "./types.ts";

const KEY = "office.intent.v1";
const CLAIM = "office.dispatch.v1";
const IntentMemo = Schema.Struct({ version: Schema.Literal(1), operationId: Id, digest: Digest });
const DispatchMemo = Schema.Struct({ ...IntentMemo.fields, nonce: Id });
export type OfficeStep = OfficeToolSource & {
  readonly step: string;
  readonly operationId?: string;
  readonly basis?: DraftTarget;
};
export const officeMemoKey = (key: string, step?: string) => (step ? `${key}.${step}` : key);

export const digestBytes = async (bytes: Uint8Array): Promise<string> => {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Discovery reads, including draft/drafts, carry no model operation ID or write claim. */
export const hasOperation = (command: OfficeCommand): boolean =>
  "input" in command && "operationId" in command.input;

const assignOperation = (command: OfficeCommand, operationId: string): OfficeCommand =>
  hasOperation(command) && "input" in command
    ? decodeWireSync(OfficeCommand)({ ...command, input: { ...command.input, operationId } })
    : command;

const describe = async (command: OfficeCommand): Promise<OfficeIntentCommand> => {
  if (command.command !== "stage-code") return command;
  const bytes = new TextEncoder().encode(command.input.source);
  return {
    command: "stage-code",
    input: {
      operationId: command.input.operationId,
      bytes: bytes.byteLength,
      digest: await digestBytes(bytes),
    },
  };
};

/** Memo is private tool-task data, not authority; the host proves accepted-input lineage. */
export const bindIntent = async (
  command: OfficeCommand,
  api: ToolExecutionApi,
  context: OfficeToolContext,
  step?: OfficeStep,
): Promise<{ command: OfficeCommand; intent: OfficeToolIntent }> => {
  context.abortSignal?.throwIfAborted();
  const description = await describe(assignOperation(command, "office_intent_placeholder"));
  const digest = await digestBytes(
    new TextEncoder().encode(
      JSON.stringify([
        "office.intent.v1",
        String(api.taskId),
        String(api.conversationId),
        api.callId,
        description,
        ...(step
          ? "referenceId" in step
            ? ["office.reference", step.referenceId, step.step, step.basis ?? null]
            : [step.attachmentId, step.step, step.basis ?? null]
          : []),
      ]),
    ),
  );
  const key = officeMemoKey(KEY, step?.step);
  const previous = await api.memo(key, context);
  const candidate = { version: 1, operationId: step?.operationId ?? crypto.randomUUID(), digest };
  const memo = decodeWireSync(IntentMemo)(previous ?? (await api.memo(key, candidate, context)));
  if (memo.digest !== digest) throw new Error("Office tool intent changed");
  const bound = assignOperation(command, memo.operationId);
  return {
    command: bound,
    intent: {
      operationId: memo.operationId,
      digest,
      command: await describe(bound),
      ...(step
        ? {
            ...("referenceId" in step
              ? { referenceId: step.referenceId }
              : { attachmentId: step.attachmentId }),
            step: step.step,
            ...(step.basis ? { basis: step.basis } : {}),
          }
        : {}),
    },
  };
};

/** Commit one dispatch claim before side effects; a competing/repeated callback may only observe. */
export const claimDispatch = async (
  intent: OfficeToolIntent,
  api: ToolExecutionApi,
  context: OfficeToolContext,
): Promise<boolean> => {
  const key = officeMemoKey(CLAIM, intent.step);
  const previous = await api.memo(key, context);
  if (previous !== undefined) {
    const saved = decodeWireSync(DispatchMemo)(previous);
    if (saved.operationId !== intent.operationId || saved.digest !== intent.digest)
      throw new Error("Office dispatch identity changed");
    return false;
  }
  const nonce = crypto.randomUUID();
  const saved = decodeWireSync(DispatchMemo)(
    await api.memo(
      key,
      {
        version: 1,
        operationId: intent.operationId,
        digest: intent.digest,
        nonce,
      },
      context,
    ),
  );
  if (saved.operationId !== intent.operationId || saved.digest !== intent.digest)
    throw new Error("Office dispatch identity changed");
  return saved.nonce === nonce;
};
