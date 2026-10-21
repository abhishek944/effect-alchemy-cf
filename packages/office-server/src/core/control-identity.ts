import { createHash } from "node:crypto";
import { Effect } from "effect";
import { nativeFailure, officeFailure } from "./failure.ts";
import type { ActorClaims, OperationIntent } from "../ports/index.ts";
import type { ImportOptions, ExportOptions, RenderSelection } from "@starter/office-contract";

export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");
export function metadataDigest(value: object, limit: number): string {
  const text = JSON.stringify(value);
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength > limit) throw officeFailure("LIMIT_EXCEEDED");
  return sha256(bytes);
}
export const boundedMetadataDigest = (value: object, limit: number) =>
  Effect.try({
    try: () => metadataDigest(value, limit),
    catch: nativeFailure,
  });

/** Fixed finite tuples survive metadata JSON key ordering. Never apply this to native document content. */
export const acceptedInputIdentity = (
  value: Extract<ActorClaims, { capability: "draft-task" }>["acceptedInput"],
) => [
  value.requestId,
  value.submissionId,
  value.conversationId,
  value.toolTaskId,
  value.generationTaskId,
  value.assistantEntryId,
  value.digest,
];
export function actorIdentity(actor: ActorClaims): readonly unknown[] {
  const base = [
    "office-actor",
    1,
    actor.capability,
    actor.owner.stage,
    actor.owner.ownerId,
    actor.principalId,
    actor.sessionEpoch,
    actor.invocationId,
    actor.expiresAt,
  ];
  if (actor.capability === "human") return base;
  return [
    ...base,
    actor.target === null
      ? null
      : [
          actor.target.documentId,
          actor.target.draftId,
          actor.target.generation,
          actor.target.expectedRevision,
        ],
    acceptedInputIdentity(actor.acceptedInput),
  ];
}
const importIdentity = (value: ImportOptions) =>
  value.kind === "sheet"
    ? "calculate" in value
      ? [value.kind, value.format, value.calculate]
      : [value.kind, value.format, value.delimiter, value.inferTypes]
    : value.kind === "doc"
      ? [value.kind, value.format, value.compatibility]
      : [value.kind, value.format];
const exportIdentity = (value: ExportOptions) => [
  value.kind,
  value.format,
  "worksheetId" in value ? value.worksheetId : null,
];
const renderIdentity = (value: RenderSelection) =>
  value.kind === "sheet" ? [value.kind, value.worksheetId, value.range] : [value.kind, value.pages];
export function intentIdentity(intent: OperationIntent): readonly unknown[] {
  const base = ["office-intent", 1, intent.kind, intent.input.operationId];
  switch (intent.kind) {
    case "create":
      return [
        ...base,
        intent.input.title,
        intent.input.destination,
        intent.input.source.kind === "blank"
          ? ["blank", intent.input.source.documentKind]
          : ["office", intent.input.source.uploadId, importIdentity(intent.input.source.options)],
      ];
    case "create-draft":
      return [...base, intent.input.documentId];
    case "execute": {
      const { target, codeId } = intent.input;
      return [
        ...base,
        target.documentId,
        target.draftId,
        target.generation,
        target.expectedRevision,
        codeId,
      ];
    }
    case "import-into": {
      const { target, source, options, selection, insertion, collision } = intent.input;
      return [
        ...base,
        target.documentId,
        target.draftId,
        target.generation,
        target.expectedRevision,
        [source.id, source.kind, source.digest, source.bytes, source.mediaType],
        importIdentity(options),
        selection.sheets,
        selection.destinationNames.map((item) => [item.sourceName, item.destinationName]),
        insertion,
        collision,
      ];
    }
    case "render":
      return [...base, intent.input.viewId, renderIdentity(intent.input.selection)];
    case "export":
      return [...base, intent.input.viewId, exportIdentity(intent.input.options)];
    case "approve":
      return [...base, intent.input.reviewId];
    case "merge":
      return [...base, intent.input.approvalOperationId];
    case "ready":
    case "reopen":
    case "discard":
      return [...base, intent.input.draftId, intent.input.generation];
  }
  throw new RangeError("Unsupported Office intent");
}
