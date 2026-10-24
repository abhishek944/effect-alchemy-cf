import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension, ToolExecutionResult } from "@earendil-works/pi-durable";
import { Option, Schema } from "effect";
import { reportFailure } from "@starter/diagnostics";
import { Id, OfficeErrors, type Target, decodeWireSync } from "@starter/office-contract";
import { OFFICE_GUIDANCE } from "./guidance.ts";
import { OfficeStagingFailure, stagingFailureDetail } from "./staging-failure.ts";
import { OfficePanelRequest, UniverCliRequest, officeToolParameters } from "./parameters.ts";
import { failedResult, failureCode, OFFICE_TOOL_RESULT_BYTES } from "./results.ts";
import { executeUniverCli } from "./cli-execute.ts";
import { attachmentDraft } from "./attachment.ts";
import { officeWorkflow } from "./workflow.ts";
import type { OfficePiHost } from "./types.ts";

export const OFFICE_EXTENSION_NAME = "office";
export const OFFICE_TOOL_NAME = "univer_cli";
export const OFFICE_PANEL_TOOL_NAME = "open_in_panel";
const panelSchema = Schema.toJsonSchemaDocument(OfficePanelRequest);
const failure = (error: unknown, taskId: number, callId: string): ToolExecutionResult => {
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
    component: "office.tool",
    operation: "execute",
    taskId,
    callId,
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

/** One server-connected CLI and a separate display action. Legacy office tools are not installed. */
export const makeOfficeExtension = (
  host: OfficePiHost,
  display?: (target: Target) => void,
): Extension =>
  defineExtension({
    name: OFFICE_EXTENSION_NAME,
    tools: [
      defineTool({
        name: OFFICE_TOOL_NAME,
        description:
          "Run the Univer CLI on an accepted attachment's saved workbook/document/draft. " +
          "command is an argv array, not a shell string. Import once with ['import']; use ['--help'] for syntax. " +
          "The server resolves Unit/worktree IDs. No owner, path, credentials, approve or merge commands.",
        parameters: officeToolParameters,
        replay: "unsafe",
        executionMode: "sequential",
        outputLimits: { maxBytes: OFFICE_TOOL_RESULT_BYTES, maxLines: 256, retain: "head" },
        execute: async (raw, api, context) => {
          let request: UniverCliRequest;
          try {
            request = decodeWireSync(UniverCliRequest)(raw);
          } catch {
            return failedResult("INVALID_INPUT", null);
          }
          try {
            return await executeUniverCli(request, api, context, host);
          } catch (error) {
            context.abortSignal?.throwIfAborted();
            return failure(error, api.taskId, api.callId);
          }
        },
      }),
      ...(display
        ? [
            defineTool({
              name: OFFICE_PANEL_TOOL_NAME,
              description:
                "Request the right-panel Univer editor for the same imported attachment. " +
                "Use univer_cli import first. Unsupported previews leave the panel unchanged. This does not prove rendering.",
              parameters: { ...panelSchema.schema, $defs: panelSchema.definitions },
              replay: "unsafe",
              executionMode: "sequential",
              execute: async (raw, api, context) => {
                let request: typeof OfficePanelRequest.Type;
                try {
                  request = decodeWireSync(OfficePanelRequest)(raw);
                } catch {
                  return failedResult("INVALID_INPUT", null);
                }
                try {
                  const workflow = officeWorkflow(
                    request,
                    request.attachmentId,
                    api,
                    context,
                    host,
                  );
                  const resolved = await attachmentDraft(workflow);
                  context.abortSignal?.throwIfAborted();
                  if (resolved.target === null)
                    return failedResult("OUTCOME_UNKNOWN", resolved.receipt.operationId);
                  // Prove the exact target through the native host before emitting navigation.
                  const opened = await workflow.run(
                    { command: "open", input: resolved.target },
                    "panel-open",
                  );
                  if (opened.kind !== "view") return failedResult("UNAVAILABLE", null);
                  display(resolved.target);
                  return {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify({
                          ok: true,
                          requested: true,
                          attachmentId: request.attachmentId,
                        }),
                      },
                    ],
                  };
                } catch (error) {
                  context.abortSignal?.throwIfAborted();
                  return failure(error, api.taskId, api.callId);
                }
              },
            }),
          ]
        : []),
    ],
    sections: [{ key: "univer_skill", render: () => OFFICE_GUIDANCE }],
  });
