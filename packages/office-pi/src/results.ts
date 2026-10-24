import { ErrorCode, OFFICE_LIMITS, safeFailure } from "@starter/office-contract";
import { Option, Schema } from "effect";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import type { OfficeOutput } from "./dispatch.ts";

export const OFFICE_TOOL_RESULT_BYTES = OFFICE_LIMITS.metadataBytes;

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
): ToolExecutionResult => {
  const isError =
    output.kind === "receipt" &&
    (output.value.error !== null || failedPhases.has(output.value.phase));
  const text = JSON.stringify({
    ok: !isError,
    command,
    operationId,
    ...output,
    ...(recovered
      ? {
          historical: true,
          note: "This observes the exact original operation; it is not a new execution or today's document state.",
        }
      : {}),
  });
  if (new TextEncoder().encode(text).byteLength > OFFICE_TOOL_RESULT_BYTES)
    return failedResult("LIMIT_EXCEEDED", operationId);
  return { isError, content: [{ type: "text", text }] };
};
