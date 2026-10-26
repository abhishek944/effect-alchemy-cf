import { OfficeInvalid, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { parseUniverCommand } from "./cli.ts";
import { attachmentDraft, attachmentImport, attachmentView } from "./attachment.ts";
import { outputResult } from "./results.ts";
import { officeWorkflow } from "./workflow.ts";
import type { UniverCliRequest } from "./parameters.ts";
import type { OfficePiHost, OfficeToolContext } from "./types.ts";
import { runReferenceCommand } from "./reference.ts";
import type { OfficeOutput } from "./dispatch.ts";

export async function executeUniverCli(
  request: UniverCliRequest,
  api: ToolExecutionApi,
  context: OfficeToolContext,
  host: OfficePiHost,
): Promise<ToolExecutionResult> {
  const action = await parseUniverCommand(request.command).catch(() => {
    throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  });
  if (action.kind === "help") return { content: [{ type: "text", text: action.text }] };
  if ("referenceId" in request) {
    const output = await runReferenceCommand(
      officeWorkflow(request, { referenceId: request.referenceId }, api, context, host),
      action,
    );
    context.abortSignal?.throwIfAborted();
    return outputResult(
      action.kind,
      output.kind === "receipt" ? output.value.operationId : null,
      output,
      action.kind === "operation",
    );
  }
  const workflow = officeWorkflow(request, request.attachmentId, api, context, host);
  let output: OfficeOutput;
  if (action.kind === "import") {
    output = { kind: "receipt", value: await attachmentImport(workflow, request.attachmentId) };
  } else if (action.kind === "operation") {
    await workflow.describe();
    output = await workflow.run({ command: "operation", operationId: action.id }, "operation");
  } else {
    const resolved = await attachmentDraft(workflow);
    if (resolved.draft === null) output = { kind: "receipt", value: resolved.receipt };
    else if (action.kind === "status") output = { kind: "draft", value: resolved.draft };
    else {
      const { draft, target } = resolved;
      const view = await attachmentView(workflow, draft, target);
      if (action.kind === "inspect")
        output = await workflow.run(
          {
            command: "inspect",
            input: {
              viewId: view.id,
              query: action.query,
              cursor: action.cursor,
            },
          },
          "inspect",
        );
      else if (action.kind === "export")
        output = await workflow.run(
          {
            command: "export",
            input: {
              operationId: "office_intent_placeholder",
              viewId: view.id,
              options: action.options,
            },
          },
          "export",
        );
      else if (action.kind === "execute") {
        if (draft.status !== "draft") throw new OfficeUnavailable(safeFailure("NOT_EDITABLE"));
        const code = await workflow.run(
          {
            command: "stage-code",
            input: {
              operationId: "office_intent_placeholder",
              source: action.code,
            },
          },
          "execute-code",
        );
        if (code.kind !== "artifact") throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
        output = await workflow.run(
          {
            command: "execute",
            input: {
              operationId: "office_intent_placeholder",
              codeId: code.value.id,
              target: {
                documentId: draft.documentId,
                draftId: draft.id,
                generation: draft.generation,
                expectedRevision: view.revision,
              },
            },
          },
          "execute",
        );
      } else {
        output = await workflow.run(
          {
            command: action.kind,
            input: {
              operationId: "office_intent_placeholder",
              draftId: draft.id,
              generation: draft.generation,
            },
          },
          action.kind,
        );
      }
    }
  }
  context.abortSignal?.throwIfAborted();
  const operationId =
    output.kind === "receipt"
      ? output.value.operationId
      : output.kind === "artifact"
        ? output.value.id
        : null;
  return outputResult(action.kind, operationId, output, action.kind === "operation");
}
