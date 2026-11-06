import { constants as bufferConstants } from "node:buffer";
import { reportFailure, type FailureContext } from "@highchat/diagnostics";
import { OfficeStagingFailure, stagingFailureDetail } from "./staging-failure.ts";
import {
  Id,
  OfficeErrors,
  ErrorCode,
  officeAttachmentIds,
  safeFailure,
} from "@highchat/office-contract";
import { Option, Schema } from "effect";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { OfficeOutput } from "./dispatch.ts";
import type { OfficeToolSource } from "./parameters.ts";
import { attachmentWorkflow } from "./attachment.ts";
import { OfficeImportRequired } from "./reference.ts";

// pi-durable 1.1.0 joins all text into one string, then UTF-8 encodes one Uint8Array.
// Its line count cannot exceed that string length; override optional defaults with runtime bounds.
export const OFFICE_TOOL_OUTPUT_LIMITS = {
  maxBytes: bufferConstants.MAX_LENGTH,
  maxLines: bufferConstants.MAX_STRING_LENGTH,
};

/** Keep physical SDK identities out of the model's application worktree namespace. */
const modelOutput = (output: OfficeOutput) => {
  if (output.kind === "view")
    return {
      kind: output.kind,
      value: {
        documentKind: output.value.kind,
        revision: output.value.revision,
        mode: output.value.mode,
      },
    };
  if (output.kind === "draft") {
    const { id, ...value } = output.value;
    return { kind: output.kind, value: { worktreeId: id, ...value } };
  }
  if (output.kind === "drafts")
    return {
      kind: output.kind,
      value: {
        ...output.value,
        items: output.value.items.map(({ id, ...draft }) => ({ worktreeId: id, ...draft })),
      },
    };
  if (output.kind === "receipt") {
    const { draftId, ...value } = output.value;
    return { kind: output.kind, value: { ...value, worktreeId: draftId } };
  }
  return output;
};

export const failureCode = (error: unknown): ErrorCode => {
  const code: unknown =
    typeof error === "object" && error !== null ? Reflect.get(error, "code") : null;
  return Option.getOrElse(Schema.decodeUnknownOption(ErrorCode)(code), () => "UNAVAILABLE");
};

export const failedResult = (code: ErrorCode, operationId: string | null): ToolExecutionResult => ({
  isError: true,
  content: [
    { type: "text", text: JSON.stringify({ ok: false, error: safeFailure(code, operationId) }) },
  ],
});

export const toolFailure = (error: unknown, context: FailureContext): ToolExecutionResult => {
  if (error instanceof OfficeImportRequired) {
    reportFailure(undefined, {
      ...context,
      event: "application.denial",
      reason: error.workflow.state === "ready" ? "worktree-required" : error.workflow.state,
    });
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: {
              code: error.code,
              message: error.workflow.instructions,
              operationId: error.workflow.operationId,
            },
            workflow: error.workflow,
          }),
        },
      ],
    };
  }
  const operationId =
    error instanceof OfficeStagingFailure
      ? error.operationId
      : error instanceof Error && OfficeErrors.some((Type) => error instanceof Type)
        ? Option.getOrElse(
            Schema.decodeUnknownOption(Id)(Reflect.get(error, "operationId")),
            () => null,
          )
        : null;
  reportFailure(error, {
    ...context,
    operationId: operationId ?? undefined,
  });
  if (error instanceof OfficeStagingFailure)
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ ok: false, error: stagingFailureDetail(error) }) },
      ],
    };
  if (error instanceof Error && "code" in error && error.code === "UNSUPPORTED_PREVIEW")
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: false,
            error: { code: "UNSUPPORTED_PREVIEW", message: error.message },
          }),
        },
      ],
    };
  return failedResult(failureCode(error), operationId);
};

const failedPhases = new Set([
  "failed-before-submit",
  "execution-unknown",
  "submission-unknown",
  "conflict",
  "needs-attention",
  "cancelled-before-dispatch",
]);

/** No prefix pretending to be a complete result, no raw error/stack or native bytes. */
export const outputResult = (
  command: string,
  operationId: string | null,
  output: OfficeOutput,
  recovered = false,
  source?: OfficeToolSource,
  revision?: number,
): ToolExecutionResult => {
  const isError =
    output.kind === "receipt" &&
    (output.value.error !== null || failedPhases.has(output.value.phase));
  const text = JSON.stringify({
    ok: !isError,
    command,
    operationId,
    ...modelOutput(output),
    ...(output.kind === "receipt" &&
    source !== undefined &&
    (command === "import" || command === "operation") &&
    output.value.operationId === officeAttachmentIds(source.attachmentId).operationId
      ? { workflow: attachmentWorkflow(source.attachmentId, output.value) }
      : {}),
    ...(source === undefined
      ? {}
      : {
          attachmentId: source.attachmentId,
          worktreeId:
            output.kind === "receipt"
              ? (output.value.draftId ?? source.worktreeId)
              : source.worktreeId,
          scope:
            source.worktreeId !== undefined ||
            (output.kind === "receipt" && output.value.draftId !== null)
              ? "worktree"
              : "main",
          revision:
            output.kind === "receipt" ? (output.value.acceptedRevision ?? revision) : revision,
        }),
    ...(recovered
      ? {
          historical: true,
          note: "This observes the exact original operation; it is not a new execution or today's document state.",
        }
      : {}),
  });
  return { isError, content: [{ type: "text", text }] };
};
