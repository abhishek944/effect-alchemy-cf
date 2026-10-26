import { Effect } from "effect";
import type { CreateDocument, Receipt, Target } from "@starter/office-contract";
import { officeAttachmentIds, officeImportOptions, OfficeNotFound } from "@starter/office-contract";
import type { OfficeRuntime } from "@starter/office-react";
import type { SavedFile } from "./chat-library-types";

export type OriginalOffice = {
  title: string;
  target: Target;
  reviewId: string | null;
  attachments: readonly string[];
};
export class OfficeOriginalPending extends Error {
  readonly canContinue: boolean;
  constructor(canContinue: boolean) {
    super("Original import is unconfirmed. Reopen this file to check the same operation.");
    this.canContinue = canContinue;
  }
}
const continuable = new Set(["reserved", "input-pinned", "queued", "running", "proposal-staged"]);
const terminal = new Set(["failed-before-submit", "cancelled-before-dispatch", "conflict"]);
const canContinue = (receipt: Receipt) =>
  continuable.has(receipt.phase) && (receipt.error === null || receipt.error.code === "BUSY");

/** CSV and modern Office originals open into the same native draft the AI may edit. */
export const isNativeOpenFile = (file: { name: string; mediaType: string }): boolean =>
  officeImportOptions(file.mediaType, file.name) !== null;

/** Read-only recovery for refresh placeholders; never stages, imports or continues. */
export async function observeOfficeOriginal(
  runtime: OfficeRuntime,
  file: SavedFile,
  signal: AbortSignal,
) {
  const target = await runtime.run(
    runtime.client.office.original({
      params: { fileRef: file.id },
      query: { chatId: file.chatId },
    }),
    { signal },
  );
  const { operationId } = officeAttachmentIds(file.id);
  const receipt = await runtime.run(
    runtime.client.office
      .receipt({ params: { operationId } })
      .pipe(
        Effect.catchTag("OfficeNotFound", (error) =>
          error instanceof OfficeNotFound && error.code === "NOT_FOUND"
            ? Effect.succeed(null)
            : Effect.fail(error),
        ),
      ),
    { signal },
  );
  return { target, receipt };
}

/** Explicit original opens create only a draft; continuation reuses its exact immutable input. */
export async function openOfficeOriginal(
  runtime: OfficeRuntime,
  file: SavedFile,
  archived: boolean,
  lifetime: AbortSignal,
  state: { uncertain: boolean },
  resume = false,
): Promise<OriginalOffice> {
  const signal = AbortSignal.any([lifetime, AbortSignal.timeout(120_000)]);
  const run = <A, E>(effect: Effect.Effect<A, E>) => runtime.run(effect, { signal });
  signal.throwIfAborted();
  const options = officeImportOptions(file.mediaType, file.name);
  if (options === null) throw new Error("This saved file cannot be opened natively.");
  const { operationId, uploadId } = officeAttachmentIds(file.id);
  const input: CreateDocument = {
    operationId,
    title: file.name.trim().slice(0, 120),
    destination: "new-draft",
    source: { kind: "office", uploadId, options },
  };
  // Viewing a confirmed AI import uses Human content discovery, not its original task controls.
  const existing = await run(
    runtime.client.office.original({
      params: { fileRef: file.id },
      query: { chatId: file.chatId },
    }),
  );
  if (existing !== null) {
    if (existing.scope.kind !== "draft")
      throw new Error("The original draft could not be resolved.");
    const scope = existing.scope;
    const draft = await run(runtime.client.office.draft({ params: { draftId: scope.draftId } }));
    if (
      draft.documentId !== existing.documentId ||
      draft.id !== scope.draftId ||
      draft.generation !== scope.generation ||
      ["discarded", "merged", "merging"].includes(draft.status)
    )
      throw new Error("The imported draft changed or is no longer available. Choose it in Files.");
    state.uncertain = false;
    return {
      title: file.name,
      target: existing,
      reviewId: draft.status === "ready" ? draft.reviewId : null,
      attachments: [file.id],
    };
  }
  const original = await run(
    runtime.client.office
      .receipt({ params: { operationId } })
      .pipe(
        Effect.catchTag("OfficeNotFound", (error) =>
          error instanceof OfficeNotFound && error.code === "NOT_FOUND"
            ? Effect.succeed(null)
            : Effect.fail(error),
        ),
      ),
  ).catch((error: unknown) => {
    if (state.uncertain) throw new OfficeOriginalPending(false);
    throw error;
  });
  let submitted = original !== null;
  if (submitted) state.uncertain = true;
  let receipt: Receipt | null = original;
  try {
    if (original === null) {
      if (archived)
        throw new Error("Archived chat · Download only. Unarchive to open a native draft.");
      signal.throwIfAborted();
      const artifact = await run(
        runtime.client.office.stageOriginal({
          params: { fileRef: file.id },
          payload: { chatId: file.chatId },
        }),
      );
      if (artifact.id !== uploadId) throw new Error("Upload identity changed.");
      signal.throwIfAborted();
      submitted = true;
      state.uncertain = true;
      receipt = await run(runtime.client.office.create({ payload: input }));
    } else if (
      resume &&
      !archived &&
      original.operationId === operationId &&
      original.kind === "create" &&
      canContinue(original)
    ) {
      // Explicit continuation only. The server checks original intent/fences and never allocates a new job.
      receipt = await run(runtime.client.office.create({ payload: input }));
    }
    if (receipt?.operationId !== operationId || receipt.kind !== "create")
      throw new OfficeOriginalPending(false);
    if (terminal.has(receipt.phase)) {
      submitted = false;
      state.uncertain = false;
      throw new Error(
        "The original import did not complete. Its receipt is retained; download the original to recover.",
      );
    }
    if (
      receipt.phase !== "confirmed" ||
      receipt.error !== null ||
      receipt.documentId === null ||
      receipt.draftId === null
    )
      throw new OfficeOriginalPending(canContinue(receipt));
    const draft = await run(runtime.client.office.draft({ params: { draftId: receipt.draftId } }));
    if (
      draft.documentId !== receipt.documentId ||
      draft.id !== receipt.draftId ||
      draft.status === "discarded" ||
      draft.status === "merged" ||
      draft.status === "merging"
    ) {
      submitted = false;
      state.uncertain = false;
      throw new Error("The imported draft is no longer available. Choose its document in Files.");
    }
    state.uncertain = false;
    return {
      title: file.name,
      target: {
        documentId: draft.documentId,
        scope: { kind: "draft", draftId: draft.id, generation: draft.generation },
      },
      reviewId: draft.status === "ready" ? draft.reviewId : null,
      attachments: [file.id],
    };
  } catch (error) {
    if (error instanceof OfficeOriginalPending) throw error;
    if (submitted) throw new OfficeOriginalPending(false);
    throw error;
  }
}
