import { Effect } from "effect";
import {
  OfficeCommand,
  OfficeInvalid,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import type {
  ArtifactRef,
  Draft,
  Inspection,
  Receipt,
  View,
  DocumentPage,
  DraftPage,
  ReviewPage,
  OfficeError,
} from "@starter/office-contract";
import type { OfficeService, TaskActor } from "../ports/index.ts";

export type AcceptedCliFile = {
  readonly filename: string;
  readonly bytes: number;
  readonly digest: string;
  readonly body: ReadableStream<Uint8Array>;
};
export type OfficeCliAccess = {
  readonly office: Pick<
    OfficeService,
    | "list"
    | "drafts"
    | "draft"
    | "open"
    | "create"
    | "createDraft"
    | "execute"
    | "importInto"
    | "inspect"
    | "render"
    | "export"
    | "ready"
    | "reopen"
    | "discard"
    | "review"
    | "receipt"
    | "upload"
  >;
  readonly actor: TaskActor;
  /** The host resolves this exact invocation's accepted immutable attachment, never a model path. */
  readonly acceptedFile: (ref: string) => Effect.Effect<AcceptedCliFile, OfficeError>;
};
export type OfficeCliOutput =
  | typeof DocumentPage.Type
  | typeof DraftPage.Type
  | Draft
  | View
  | ArtifactRef
  | Inspection
  | Receipt
  | typeof ReviewPage.Type;
export type ResolveOfficeCli = (
  command: OfficeCommand,
) => Effect.Effect<OfficeCliAccess, OfficeError>;
const stream = (bytes: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
/** One finite command entry. The host supplies fresh accepted-input/task proof at every call. */
export const runOfficeCommand = Effect.fn("Office.cli.command")(function* (
  resolve: ResolveOfficeCli,
  raw: unknown,
): Effect.fn.Return<OfficeCliOutput, OfficeError> {
  const command = yield* Effect.try({
    try: () => decodeWireSync(OfficeCommand)(raw),
    catch: () => new OfficeInvalid(safeFailure("INVALID_INPUT")),
  });
  const { office, actor, acceptedFile } = yield* resolve(command);
  switch (command.command) {
    case "list":
      return yield* office.list(actor, command.cursor);
    case "drafts":
      return yield* office.drafts(actor, command.cursor);
    case "draft":
      return yield* office.draft(actor, command.draftId);
    case "open":
      return yield* office.open(actor, command.input);
    case "create":
      return yield* office.create(actor, command.input);
    case "create-draft":
      return yield* office.createDraft(actor, command.input);
    case "execute":
      return yield* office.execute(actor, command.input);
    case "import-into":
      return yield* office.importInto(actor, command.input);
    case "inspect":
      return yield* office.inspect(actor, command.input);
    case "render":
      return yield* office.render(actor, command.input);
    case "export":
      return yield* office.export(actor, command.input);
    case "ready":
      return yield* office.ready(actor, command.input);
    case "reopen":
      return yield* office.reopen(actor, command.input);
    case "discard":
      return yield* office.discard(actor, command.input);
    case "review":
      return yield* office.review(actor, command.reviewId, command.cursor);
    case "operation":
      return yield* office.receipt(actor, command.operationId);
    case "stage-code": {
      const bytes = new TextEncoder().encode(command.input.source);
      return yield* office.upload(actor, {
        operationId: command.input.operationId,
        kind: "code",
        filename: "facade.js",
        declaredBytes: bytes.byteLength,
        expectedDigest: null,
        body: stream(bytes),
      });
    }
    case "stage-file": {
      const file = yield* acceptedFile(command.input.fileRef);
      return yield* office.upload(actor, {
        operationId: command.input.operationId,
        kind: "upload",
        filename: file.filename,
        declaredBytes: file.bytes,
        expectedDigest: file.digest,
        body: file.body,
      });
    }
  }
  return yield* Effect.fail(new OfficeInvalid(safeFailure("INVALID_INPUT")));
});
