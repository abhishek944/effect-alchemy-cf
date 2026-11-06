import { withDiagnostic } from "@highchat/diagnostics";
import { OfficeInvalid, OfficeUnavailable, safeFailure } from "@highchat/office-contract";
import type { ToolExecutionApi, ToolExecutionResult } from "@earendil-works/pi-durable";
import { parseUniverCommand } from "./cli.ts";
import { attachmentImport } from "./attachment.ts";
import { outputResult } from "./results.ts";
import { officeWorkflow } from "./workflow.ts";
import type { UniverCliRequest } from "./parameters.ts";
import type { OfficePiHost, OfficeToolContext } from "./types.ts";
import { sourceTarget, sourceView } from "./reference.ts";
import type { OfficeOutput } from "./dispatch.ts";

export async function executeUniverCli(
  request: UniverCliRequest,
  api: ToolExecutionApi,
  context: OfficeToolContext,
  host: OfficePiHost,
): Promise<ToolExecutionResult> {
  const action = await parseUniverCommand(request.command).catch(() => {
    throw withDiagnostic(new OfficeInvalid(safeFailure("INVALID_INPUT")), "command-parse-invalid");
  });
  if (action.kind === "help") return { content: [{ type: "text", text: action.text }] };
  if (["execute", "ready", "reopen"].includes(action.kind) && request.worktreeId === undefined)
    throw withDiagnostic(new OfficeInvalid(safeFailure("INVALID_INPUT")), "worktree-required");
  if (["import", "worktree-create"].includes(action.kind) && request.worktreeId !== undefined)
    throw withDiagnostic(new OfficeInvalid(safeFailure("INVALID_INPUT")), "main-source-required");
  const workflow = officeWorkflow(request, request, api, context, host);
  let output: OfficeOutput;
  let revision: number | undefined;
  if (action.kind === "import") {
    output = { kind: "receipt", value: await attachmentImport(workflow, request.attachmentId) };
  } else if (action.kind === "operation") {
    await workflow.describeSource();
    output = await workflow.run({ command: "operation", operationId: action.id }, "operation");
  } else if (action.kind === "worktree-list") {
    const source = await workflow.describeSource();
    if (source === null) throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
    const page = await workflow.run({ command: "drafts", cursor: action.cursor }, "drafts");
    if (page.kind !== "drafts") throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
    output = {
      kind: "drafts",
      value: {
        ...page.value,
        items: page.value.items.filter((draft) => draft.documentId === source.documentId),
      },
    };
  } else {
    const { target } = await sourceTarget(workflow, request);
    const view = await sourceView(workflow, target);
    revision = view.revision;
    if (action.kind === "worktree-create")
      output = await workflow.run(
        {
          command: "create-draft",
          input: {
            operationId: "office_intent_placeholder",
            documentId: target.documentId,
          },
        },
        "worktree-create",
      );
    else if (action.kind === "status") {
      output =
        target.scope.kind === "main"
          ? { kind: "view", value: view }
          : await workflow.run({ command: "draft", draftId: target.scope.draftId }, "draft");
    } else if (action.kind === "inspect")
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
    else {
      if (target.scope.kind !== "draft") throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
      const basis = {
        documentId: target.documentId,
        draftId: target.scope.draftId,
        generation: target.scope.generation,
        expectedRevision: view.revision,
      };
      if (action.kind === "execute") {
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
              target: basis,
            },
          },
          "execute",
        );
      } else
        output = await workflow.run(
          {
            command: action.kind,
            input: {
              operationId: "office_intent_placeholder",
              draftId: basis.draftId,
              generation: basis.generation,
            },
          },
          action.kind,
        );
    }
  }
  context.abortSignal?.throwIfAborted();
  const operationId = output.kind === "receipt" ? output.value.operationId : null;
  return outputResult(
    action.kind,
    operationId,
    output,
    action.kind === "operation",
    request,
    revision,
  );
}
