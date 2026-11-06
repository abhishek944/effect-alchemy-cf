import { defineTool } from "@earendil-works/pi-durable";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { reportEvent, reportFailure } from "@highchat/diagnostics";
import { decodeWireSync } from "@highchat/office-contract";
import { AttachmentListRequest, attachmentListParameters } from "./parameters.ts";
import { failedResult, failureCode, OFFICE_TOOL_OUTPUT_LIMITS } from "./results.ts";
import type { OfficePiHost } from "./types.ts";

export const OFFICE_ATTACHMENTS_TOOL_NAME = "get_attachments";

/** Read-only, paginated saved-file discovery for the tool's own bound chat. Never bytes. */
export const attachmentListTool = (host: OfficePiHost): ToolRegistration =>
  defineTool({
    name: OFFICE_ATTACHMENTS_TOOL_NAME,
    description:
      "List saved attachments of this chat with attachmentId, names, kinds and media types. " +
      "Use a returned ID as univer_cli/open_in_panel attachmentId; earlier saved files need no new upload. " +
      "Saved originals are not imported Office content: call import first, then inspect with its confirmed worktreeId. " +
      "Pass nextCursor as cursor for the next page. Metadata only: no file bytes, no chat or owner argument, " +
      "and listing grants no read, edit or approval authority.",
    parameters: attachmentListParameters,
    outputLimits: OFFICE_TOOL_OUTPUT_LIMITS,
    replay: "safe",
    execute: async (raw, api, context) => {
      const diagnostic = {
        component: "office.tool",
        operation: OFFICE_ATTACHMENTS_TOOL_NAME,
        taskId: api.taskId,
        callId: api.callId,
        toolArguments: raw,
      };
      reportEvent({ ...diagnostic, phase: "arguments-received" });
      let request: typeof AttachmentListRequest.Type;
      try {
        request = decodeWireSync(AttachmentListRequest)(raw);
      } catch {
        reportEvent({
          ...diagnostic,
          event: "application.denial",
          reason: "argument-schema-invalid",
        });
        return failedResult("INVALID_INPUT", null);
      }
      try {
        const page = await host.attachments({
          api,
          context,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        });
        context.abortSignal?.throwIfAborted();
        const text = JSON.stringify({
          ok: true,
          nextCursor: page.nextCursor,
          files: page.files.map(({ id, ...file }) => ({ attachmentId: id, ...file })),
        });
        reportEvent({ ...diagnostic, event: "application.complete", outcome: "confirmed" });
        return { content: [{ type: "text", text }] };
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        reportFailure(error, diagnostic);
        return failedResult(failureCode(error), null);
      }
    },
  });
