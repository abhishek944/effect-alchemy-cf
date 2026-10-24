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

/** Real endpoint mapping; principal/authenticated transport stay captured in the host port. */
export const dispatch = async (
  command: OfficeCommand,
  access: OfficeTaskAccess,
  signal?: AbortSignal,
): Promise<OfficeOutput> => {
  const client = access.client;
  switch (command.command) {
    case "list":
      return {
        kind: "documents",
        value: decodeWireSync(DocumentPage)(await client.list({ cursor: command.cursor })),
      };
    case "draft":
      return {
        kind: "draft",
        value: checkDraft(await client.draft({ id: command.draftId }), command.draftId),
      };
    case "drafts":
      return {
        kind: "drafts",
        value: decodeWireSync(DraftPage)(await client.drafts({ cursor: command.cursor })),
      };
    case "open": {
      const view = decodeWireSync(View)(await client.open(command.input));
      const scope = command.input.scope;
      if (
        view.documentId !== command.input.documentId ||
        (view.nativeTarget.kind !== "pinned-snapshot" && view.nativeTarget.kind !== scope.kind) ||
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
      const inspection = decodeWireSync(Inspection)(await client.inspect(command.input));
      if (inspection.viewId !== command.input.viewId)
        throw new Error("Office inspection identity mismatch");
      return { kind: "inspection", value: inspection };
    }
    case "review": {
      const review = decodeWireSync(ReviewPage)(
        await client.review({ reviewId: command.reviewId, cursor: command.cursor }),
      );
      if (review.reviewId !== command.reviewId) throw new Error("Office review identity mismatch");
      return { kind: "review", value: review };
    }
    case "operation":
      return {
        kind: "receipt",
        value: checkReceipt(
          await client.receipt({ operationId: command.operationId }),
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
      const operationId = command.input.operationId;
      const raw = await receiptCall(command, client);
      return {
        kind: "receipt",
        value: checkReceipt(raw, operationId, receiptKind(command)),
      };
    }
  }
  throw new Error("Unsupported Office command");
};

const receiptCall = (
  command: Extract<
    OfficeCommand,
    {
      command:
        | "create"
        | "create-draft"
        | "execute"
        | "import-into"
        | "render"
        | "export"
        | "ready"
        | "reopen"
        | "discard";
    }
  >,
  client: OfficeTaskAccess["client"],
): Promise<unknown> => {
  switch (command.command) {
    case "create":
      return client.create(command.input);
    case "create-draft":
      return client.createDraft(command.input);
    case "execute":
      return client.execute(command.input);
    case "import-into":
      return client.importInto(command.input);
    case "render":
      return client.render(command.input);
    case "export":
      return client.export(command.input);
    case "ready":
      return client.ready(command.input);
    case "reopen":
      return client.reopen(command.input);
    case "discard":
      return client.discard(command.input);
  }
  throw new Error("Unsupported Office command");
};
