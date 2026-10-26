import { defineTool } from "@earendil-works/pi-durable";
import type { ToolRegistration } from "@earendil-works/pi-durable";
import { reportFailure } from "@starter/diagnostics";
import { decodeWireSync } from "@starter/office-contract";
import { AttachmentListRequest, attachmentListParameters } from "./parameters.ts";
import { failedResult, failureCode, OFFICE_TOOL_RESULT_BYTES } from "./results.ts";
import type { OfficePiHost } from "./types.ts";

export const OFFICE_ATTACHMENTS_TOOL_NAME = "get_attachments";

/** Read-only, paginated saved-file discovery for the tool's own bound chat. Never bytes. */
export const attachmentListTool = (host: OfficePiHost): ToolRegistration =>
  defineTool({
    name: OFFICE_ATTACHMENTS_TOOL_NAME,
    description:
      "List saved attachments of this chat with their IDs, names, kinds and media types. " +
      "Use a returned ID as univer_cli/open_in_panel attachmentId; earlier saved files need no new upload. " +
      "Pass nextCursor as cursor for the next page. Metadata only: no file bytes, no chat or owner argument, " +
      "and listing grants no read, edit or approval authority.",
    parameters: attachmentListParameters,
    replay: "safe",
    execute: async (raw, api, context) => {
      let request: typeof AttachmentListRequest.Type;
      try {
        request = decodeWireSync(AttachmentListRequest)(raw);
      } catch {
        return failedResult("INVALID_INPUT", null);
      }
      try {
        const page = await host.attachments({
          api,
          context,
          ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
        });
        context.abortSignal?.throwIfAborted();
        const text = JSON.stringify({ ok: true, ...page });
        if (new TextEncoder().encode(text).byteLength > OFFICE_TOOL_RESULT_BYTES)
          return failedResult("LIMIT_EXCEEDED", null);
        return { content: [{ type: "text", text }] };
      } catch (error) {
        context.abortSignal?.throwIfAborted();
        reportFailure(error, {
          component: "office.tool",
          operation: "list-attachments",
          taskId: api.taskId,
          callId: api.callId,
        });
        return failedResult(failureCode(error), null);
      }
    },
  });
