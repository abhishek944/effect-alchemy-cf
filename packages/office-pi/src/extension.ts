import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { Extension } from "@earendil-works/pi-durable";
import { Schema } from "effect";
import { reportEvent } from "@highchat/diagnostics";
import { type Target, decodeWireSync } from "@highchat/office-contract";
import { OFFICE_GUIDANCE } from "./guidance.ts";
import { OfficePanelRequest, UniverCliRequest, officeToolParameters } from "./parameters.ts";
import { attachmentListTool } from "./attachment-tool.ts";
import { failedResult, toolFailure, OFFICE_TOOL_OUTPUT_LIMITS } from "./results.ts";
import { executeUniverCli } from "./cli-execute.ts";
import { sourceTarget } from "./reference.ts";
import { officeWorkflow } from "./workflow.ts";
import type { OfficePiHost } from "./types.ts";

export const OFFICE_EXTENSION_NAME = "office";
export const OFFICE_TOOL_NAME = "univer_cli";
export const OFFICE_PANEL_TOOL_NAME = "open_in_panel";
const panelSchema = Schema.toJsonSchemaDocument(OfficePanelRequest, { onExcessProperty: "error" });

/** One server-connected CLI and a separate display action. Legacy office tools are not installed. */
export const makeOfficeExtension = (
  host: OfficePiHost,
  display?: (target: Target) => void,
): Extension =>
  defineExtension({
    name: OFFICE_EXTENSION_NAME,
    tools: [
      attachmentListTool(host),
      defineTool({
        name: OFFICE_TOOL_NAME,
        description:
          "Run the Univer CLI with attachmentId for Main, plus worktreeId for a specific working draft. " +
          "New originals MUST follow ['import'] -> confirmed worktreeId -> ['inspect', ...] with that worktreeId. Never inspect a new upload first. " +
          "Commands are argv arrays, not shell strings; use ['--help'] for syntax. " +
          "Edits require worktreeId. Import/worktree create returns it. The server opens the latest revision and fences writes. No approve or merge commands.",
        parameters: officeToolParameters,
        outputLimits: OFFICE_TOOL_OUTPUT_LIMITS,
        replay: "unsafe",
        executionMode: "sequential",
        execute: async (raw, api, context) => {
          const diagnostic = {
            component: "office.tool",
            operation: OFFICE_TOOL_NAME,
            taskId: api.taskId,
            callId: api.callId,
            toolArguments: raw,
          };
          reportEvent({ ...diagnostic, phase: "arguments-received" });
          let request: UniverCliRequest;
          try {
            request = decodeWireSync(UniverCliRequest)(raw);
          } catch {
            reportEvent({
              ...diagnostic,
              event: "application.denial",
              reason: "argument-schema-invalid",
            });
            return failedResult("INVALID_INPUT", null);
          }
          try {
            const result = await executeUniverCli(request, api, context, host);
            reportEvent({
              ...diagnostic,
              event: "application.complete",
              outcome: result.isError ? "failed" : "confirmed",
            });
            return result;
          } catch (error) {
            context.abortSignal?.throwIfAborted();
            return toolFailure(error, diagnostic);
          }
        },
      }),
      ...(display
        ? [
            defineTool({
              name: OFFICE_PANEL_TOOL_NAME,
              description:
                "Open attachmentId Main, or attachmentId plus worktreeId for that specific working draft, at its latest saved revision. " +
                "Unsupported previews leave the panel unchanged. This does not prove rendering.",
              parameters: { ...panelSchema.schema, $defs: panelSchema.definitions },
              outputLimits: OFFICE_TOOL_OUTPUT_LIMITS,
              replay: "unsafe",
              executionMode: "sequential",
              execute: async (raw, api, context) => {
                const diagnostic = {
                  component: "office.tool",
                  operation: OFFICE_PANEL_TOOL_NAME,
                  taskId: api.taskId,
                  callId: api.callId,
                  toolArguments: raw,
                };
                reportEvent({ ...diagnostic, phase: "arguments-received" });
                let request: typeof OfficePanelRequest.Type;
                try {
                  request = decodeWireSync(OfficePanelRequest)(raw);
                } catch {
                  reportEvent({
                    ...diagnostic,
                    event: "application.denial",
                    reason: "argument-schema-invalid",
                  });
                  return failedResult("INVALID_INPUT", null);
                }
                try {
                  const workflow = officeWorkflow(request, request, api, context, host);
                  const resolved = await sourceTarget(workflow, request);
                  context.abortSignal?.throwIfAborted();
                  // Prove the exact target through the native host before emitting navigation.
                  const opened = await workflow.run(
                    { command: "open", input: resolved.target },
                    "panel-open",
                  );
                  if (opened.kind !== "view") {
                    reportEvent({
                      ...diagnostic,
                      event: "application.complete",
                      reason: "panel-view-missing",
                      outcome: "failed",
                    });
                    return failedResult("UNAVAILABLE", null);
                  }
                  display(resolved.target);
                  reportEvent({
                    ...diagnostic,
                    event: "application.complete",
                    outcome: "confirmed",
                  });
                  return {
                    content: [
                      {
                        type: "text",
                        text: JSON.stringify({
                          ok: true,
                          requested: true,
                          ...request,
                          scope: request.worktreeId === undefined ? "main" : "worktree",
                          revision: opened.value.revision,
                        }),
                      },
                    ],
                  };
                } catch (error) {
                  context.abortSignal?.throwIfAborted();
                  return toolFailure(error, diagnostic);
                }
              },
            }),
          ]
        : []),
    ],
    sections: [{ key: "univer_skill", render: () => OFFICE_GUIDANCE }],
  });
