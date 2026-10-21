import { Effect } from "effect";
import {
  DocumentPage,
  Draft,
  DraftPage,
  Inspection,
  Receipt,
  ReviewPage,
  View,
  decodeWireSync,
} from "@starter/office-contract";
import type { ArtifactRef, OfficeCommand } from "@starter/office-contract";
import { stage } from "./staging.ts";
import type { OfficeTaskAccess } from "./types.ts";

export type OfficeOutput =
  | { readonly kind: "documents"; readonly value: typeof DocumentPage.Type }
  | { readonly kind: "draft"; readonly value: Draft }
  | { readonly kind: "drafts"; readonly value: typeof DraftPage.Type }
  | { readonly kind: "view"; readonly value: View }
  | { readonly kind: "artifact"; readonly value: ArtifactRef }
  | { readonly kind: "inspection"; readonly value: Inspection }
  | { readonly kind: "review"; readonly value: ReviewPage }
  | { readonly kind: "receipt"; readonly value: Receipt };

export const receiptKind = (command: OfficeCommand): Receipt["kind"] | null => {
  switch (command.command) {
    case "create":
    case "create-draft":
    case "execute":
    case "import-into":
    case "render":
    case "export":
    case "ready":
    case "reopen":
    case "discard":
      return command.command;
    default:
      return null;
  }
};

export const checkReceipt = (raw: unknown, operationId: string, kind: Receipt["kind"] | null) => {
  const receipt = decodeWireSync(Receipt)(raw);
  if (receipt.operationId !== operationId || (kind !== null && receipt.kind !== kind))
    throw new Error("Office receipt identity mismatch");
  return receipt;
};

export const checkDraft = (raw: unknown, draftId: string): Draft => {
  const draft = decodeWireSync(Draft)(raw);
  if (draft.id !== draftId) throw new Error("Office draft identity mismatch");
  return draft;
};

/** Real endpoint mapping; principal/authenticated transport stay captured in the host client. */
export const dispatch = async (
  command: OfficeCommand,
  access: OfficeTaskAccess,
  signal?: AbortSignal,
): Promise<OfficeOutput> => {
  const client = access.client;
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    Effect.runPromise(effect, signal === undefined ? {} : { signal });
  switch (command.command) {
    case "list":
      return {
        kind: "documents",
        value: decodeWireSync(DocumentPage)(
          await run(client.list({ query: { cursor: command.cursor } })),
        ),
      };
    case "draft":
      return {
        kind: "draft",
        value: checkDraft(
          await run(client.draft({ params: { draftId: command.draftId } })),
          command.draftId,
        ),
      };
    case "drafts":
      return {
        kind: "drafts",
        value: decodeWireSync(DraftPage)(
          await run(client.drafts({ query: { cursor: command.cursor } })),
        ),
      };
    case "open": {
      const view = decodeWireSync(View)(await run(client.open({ payload: command.input })));
      const scope = command.input.scope;
      if (
        view.documentId !== command.input.documentId ||
        view.nativeTarget.kind !== scope.kind ||
        (scope.kind === "draft" &&
          view.nativeTarget.kind === "draft" &&
          view.nativeTarget.generation !== scope.generation)
      )
        throw new Error("Office view identity mismatch");
      return { kind: "view", value: view };
    }
    case "stage-code":
    case "stage-file":
      return { kind: "artifact", value: await stage(command, access, signal) };
    case "inspect": {
      const inspection = decodeWireSync(Inspection)(
        await run(client.inspect({ payload: command.input })),
      );
      if (inspection.viewId !== command.input.viewId)
        throw new Error("Office inspection identity mismatch");
      return { kind: "inspection", value: inspection };
    }
    case "review": {
      const review = decodeWireSync(ReviewPage)(
        await run(
          client.review({
            params: { reviewId: command.reviewId },
            query: { cursor: command.cursor },
          }),
        ),
      );
      if (review.reviewId !== command.reviewId) throw new Error("Office review identity mismatch");
      return { kind: "review", value: review };
    }
    case "operation":
      return {
        kind: "receipt",
        value: checkReceipt(
          await run(
            client.receipt({
              params: { operationId: command.operationId },
            }),
          ),
          command.operationId,
          null,
        ),
      };
    case "create":
    case "create-draft":
    case "execute":
    case "import-into":
    case "render":
    case "export":
    case "ready":
    case "reopen":
    case "discard": {
      const input = command.input;
      const result =
        command.command === "create"
          ? client.create({ payload: command.input })
          : command.command === "create-draft"
            ? client.createDraft({ payload: command.input })
            : command.command === "import-into"
              ? client.importInto({ payload: command.input })
              : command.command === "execute"
                ? client.execute({ payload: command.input })
                : command.command === "render"
                  ? client.render({ payload: command.input })
                  : command.command === "export"
                    ? client.export({ payload: command.input })
                    : command.command === "ready"
                      ? client.ready({ payload: command.input })
                      : command.command === "reopen"
                        ? client.reopen({ payload: command.input })
                        : client.discard({ payload: command.input });
      return {
        kind: "receipt",
        value: checkReceipt(await run(result), input.operationId, receiptKind(command)),
      };
    }
  }
  throw new Error("Unsupported Office command");
};
