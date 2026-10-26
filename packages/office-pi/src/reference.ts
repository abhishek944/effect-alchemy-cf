import { OfficeInvalid, OfficeUnavailable, safeFailure } from "@starter/office-contract";
import type { DraftTarget, Target } from "@starter/office-contract";
import type { OfficeWorkflow } from "./workflow.ts";
import type { OfficeOutput } from "./dispatch.ts";
import type { UniverAction } from "./cli.ts";

/** Resolve only the accepted native descriptor. Never import it through an original-file path. */
export async function referenceTarget(workflow: OfficeWorkflow): Promise<Target> {
  const { target } = await workflow.describeReference();
  const basis = workflow.referenceBasis;
  if (basis !== undefined)
    return {
      documentId: basis.documentId,
      scope: { kind: "draft", draftId: basis.draftId, generation: basis.generation },
    };
  return {
    documentId: target.documentId,
    scope:
      target.kind === "main"
        ? { kind: "main" }
        : { kind: "draft", draftId: target.draftId, generation: target.generation },
  };
}

/** Root reuses current accepted-input lineage and exact basis; selected scope is not a new ACL. */
export async function runReferenceCommand(
  workflow: OfficeWorkflow,
  action: Exclude<UniverAction, { kind: "help" }>,
): Promise<OfficeOutput> {
  const reference = await workflow.describeReference();
  const captured = reference.target;
  const confirmed = workflow.referenceBasis;
  if (action.kind === "import") throw new OfficeInvalid(safeFailure("INVALID_INPUT"));
  if (action.kind === "operation")
    return workflow.run({ command: "operation", operationId: action.id }, "operation");
  let target: Target = {
    documentId: captured.documentId,
    scope:
      captured.kind === "main"
        ? { kind: "main" }
        : { kind: "draft", draftId: captured.draftId, generation: captured.generation },
  };
  if (confirmed !== undefined) {
    target = {
      documentId: confirmed.documentId,
      scope: { kind: "draft", draftId: confirmed.draftId, generation: confirmed.generation },
    };
    workflow.basis = confirmed;
  } else if (captured.kind === "draft")
    workflow.basis = {
      documentId: captured.documentId,
      draftId: captured.draftId,
      generation: captured.generation,
      expectedRevision: captured.expectedRevision,
    };
  if (action.kind === "status" && target.scope.kind === "draft")
    return workflow.run({ command: "draft", draftId: target.scope.draftId }, "draft");
  if (action.kind === "execute" && captured.kind === "main" && confirmed === undefined) {
    const fork = await workflow.run(
      {
        command: "create-draft",
        input: {
          operationId: "office_intent_placeholder",
          documentId: captured.documentId,
        },
      },
      "reference-fork",
    );
    if (fork.kind !== "receipt") throw new OfficeUnavailable(safeFailure("CONTENT_REQUIRED"));
    if (fork.value.phase !== "confirmed" || fork.value.draftId === null) return fork;
    target = {
      documentId: captured.documentId,
      scope: { kind: "draft", draftId: fork.value.draftId, generation: 1 },
    };
  }
  // This exact source is checked by Root. A changed head cannot rebase onto unrelated edits.
  const opened = await workflow.run({ command: "open", input: target }, "view");
  if (opened.kind !== "view") throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
  if (action.kind === "inspect")
    return workflow.run(
      {
        command: "inspect",
        input: {
          viewId: opened.value.id,
          query: action.query,
          cursor: action.cursor,
        },
      },
      "inspect",
    );
  if (action.kind === "export")
    return workflow.run(
      {
        command: "export",
        input: {
          operationId: "office_intent_placeholder",
          viewId: opened.value.id,
          options: action.options,
        },
      },
      "export",
    );
  if (action.kind === "status") return opened;
  if (target.scope.kind !== "draft") throw new OfficeUnavailable(safeFailure("NOT_EDITABLE"));
  const basis: DraftTarget = {
    documentId: target.documentId,
    draftId: target.scope.draftId,
    generation: target.scope.generation,
    expectedRevision: opened.value.revision,
  };
  workflow.basis = basis;
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
    return workflow.run(
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
  }
  return workflow.run(
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
