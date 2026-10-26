import { Schema } from "effect";
import { Digest, decodeWireSync } from "@starter/office-contract";
import {
  OfficePanelRequest,
  UniverCliRequest,
  OFFICE_TOOL_NAME,
  OFFICE_PANEL_TOOL_NAME,
  type OfficeToolIntent,
} from "@starter/office-pi";
import type { ToolExecutionApi } from "@earendil-works/pi-durable";

const StepMemo = Schema.Struct({ requestDigest: Digest, intentDigest: Digest });
async function digest(value: unknown) {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The trusted CLI program derives private steps; model args never supply task/native claims. */
export async function officeIntentMatches(
  raw: unknown,
  intent: OfficeToolIntent,
  api: Pick<ToolExecutionApi, "taskId" | "conversationId" | "callId">,
  toolName: string,
  memo: unknown,
): Promise<boolean> {
  if (!intent.step || (intent.attachmentId === undefined) === (intent.referenceId === undefined))
    return false;
  const request =
    toolName === OFFICE_PANEL_TOOL_NAME
      ? decodeWireSync(OfficePanelRequest)(raw)
      : toolName === OFFICE_TOOL_NAME
        ? decodeWireSync(UniverCliRequest)(raw)
        : null;
  if (
    request === null ||
    ("referenceId" in request
      ? request.referenceId !== intent.referenceId || intent.attachmentId !== undefined
      : request.attachmentId !== intent.attachmentId || intent.referenceId !== undefined)
  )
    return false;
  const saved = decodeWireSync(StepMemo)(memo);
  if (saved.requestDigest !== (await digest(request)) || saved.intentDigest !== intent.digest)
    return false;
  const command = intent.command;
  const unbound =
    "input" in command && "operationId" in command.input
      ? { ...command, input: { ...command.input, operationId: "office_intent_placeholder" } }
      : command;
  return (
    intent.digest ===
    (await digest([
      "office.intent.v1",
      String(api.taskId),
      String(api.conversationId),
      api.callId,
      unbound,
      ...(intent.referenceId === undefined
        ? [intent.attachmentId, intent.step, intent.basis ?? null]
        : ["office.reference", intent.referenceId, intent.step, intent.basis ?? null]),
    ]))
  );
}
