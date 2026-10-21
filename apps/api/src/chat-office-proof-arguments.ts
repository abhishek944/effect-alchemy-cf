import { OfficeCommand, decodeWireSync } from "@starter/office-contract";
import {
  OfficeToolRequest,
  type OfficeIntentCommand,
  type OfficeToolIntent,
} from "@starter/office-pi";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";
import { sameImageRequestValue } from "./chat-image-request-values.ts";

async function digest(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Match actual Pi bindIntent normalization AND its task/conversation/call-bound memo digest. */
export async function officeIntentMatches(
  raw: unknown,
  intent: OfficeToolIntent,
  api: Pick<ToolExecutionApi, "taskId" | "conversationId" | "callId">,
): Promise<boolean> {
  const command = decodeWireSync(OfficeToolRequest)(raw).request;
  const bound =
    "input" in command && "operationId" in command.input
      ? decodeWireSync(OfficeCommand)({
          ...command,
          input: { ...command.input, operationId: intent.operationId },
        })
      : command;
  let description: OfficeIntentCommand;
  if (bound.command === "stage-code") {
    const bytes = new TextEncoder().encode(bound.input.source);
    description = {
      command: "stage-code",
      input: {
        operationId: bound.input.operationId,
        bytes: bytes.byteLength,
        digest: await digest(bytes),
      },
    };
  } else description = bound;
  if (!sameImageRequestValue(description, intent.command)) return false;
  const unbound =
    "input" in description && "operationId" in description.input
      ? {
          ...description,
          input: { ...description.input, operationId: "office_intent_placeholder" },
        }
      : description;
  const expected = await digest(
    new TextEncoder().encode(
      JSON.stringify([
        "office.intent.v1",
        String(api.taskId),
        String(api.conversationId),
        api.callId,
        unbound,
      ]),
    ),
  );
  return expected === intent.digest;
}
