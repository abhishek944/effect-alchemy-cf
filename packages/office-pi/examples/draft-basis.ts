import { Effect } from "effect";
import { Draft, View, OfficeInvalid, decodeWireSync } from "@starter/office-contract";
import type { OfficeTaskPort } from "@starter/office-pi";

/** Use after a confirmed create/reopen receipt, or with an authorized discovered draft ID. */
export const readDraftExecutionBasis = (client: OfficeTaskPort, draftId: string) =>
  Effect.gen(function* () {
    const draft = decodeWireSync(Draft)(yield* Effect.promise(() => client.draft({ id: draftId })));
    if (draft.id !== draftId || draft.status !== "draft")
      return yield* new OfficeInvalid({
        code: "NOT_EDITABLE",
        operationId: null,
        message: "Read the current editable draft before opening its execution basis.",
      });
    const view = decodeWireSync(View)(
      yield* Effect.promise(() =>
        client.open({
          documentId: draft.documentId,
          scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
        }),
      ),
    );
    if (
      view.documentId !== draft.documentId ||
      view.nativeTarget.kind !== "draft" ||
      view.nativeTarget.generation !== draft.generation
    )
      return yield* new OfficeInvalid({
        code: "STALE_BASIS",
        operationId: null,
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
