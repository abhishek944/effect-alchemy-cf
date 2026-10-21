import { Effect } from "effect";
import { Draft, View, OfficeInvalid, decodeWireSync } from "@starter/office-contract";
import type { OfficeTaskClient } from "@starter/office-pi";

/** Use after a confirmed create/reopen receipt, or with an authorized discovered draft ID. */
export const readDraftExecutionBasis = (client: OfficeTaskClient, draftId: string) =>
  Effect.gen(function* () {
    const draft = decodeWireSync(Draft)(yield* client.draft({ params: { draftId } }));
    if (draft.id !== draftId || draft.status !== "draft")
      return yield* new OfficeInvalid({
        code: "NOT_EDITABLE",
        operationId: null,
        retry: "never",
        message: "Read the current editable draft before opening its execution basis.",
      });
    const view = decodeWireSync(View)(
      yield* client.open({
        payload: {
          documentId: draft.documentId,
          scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
        },
      }),
    );
    if (
      view.documentId !== draft.documentId ||
      view.nativeTarget.kind !== "draft" ||
      view.nativeTarget.generation !== draft.generation
    )
      return yield* new OfficeInvalid({
        code: "STALE_BASIS",
        operationId: null,
        retry: "never",
        message: "The draft view no longer matches the read generation.",
      });
    return {
      draft,
      view,
      target: {
        documentId: draft.documentId,
        draftId: draft.id,
        generation: draft.generation,
        expectedRevision: view.revision,
      },
    };
  });
