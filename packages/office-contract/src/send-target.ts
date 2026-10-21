import { Schema } from "effect";
import { Count, Id, Kind, Revision, decodeWireSync } from "./primitives.ts";

const Common = {
  viewId: Id,
  documentId: Id,
  documentKind: Kind,
  expectedRevision: Revision,
};
/** Frozen displayed selection only. View IDs and revisions are NOT task/native authority. */
export const OfficeSendTarget = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("main"), ...Common }),
  Schema.Struct({
    kind: Schema.Literal("draft"),
    ...Common,
    draftId: Id,
    generation: Count,
  }),
]);
export type OfficeSendTarget = typeof OfficeSendTarget.Type;

/** Scalar DTO: clone/validate before any await or upload; never retain a mutable pane object. */
export const freezeOfficeSendTarget = (input: OfficeSendTarget): OfficeSendTarget =>
  Object.freeze(decodeWireSync(OfficeSendTarget)(input));

/** Deterministic intent correlation, independent of incoming object property order. */
export const officeSendTargetIdentity = (target: OfficeSendTarget): readonly unknown[] => [
  "office-send-target",
  1,
  target.kind,
  target.viewId,
  target.documentId,
  target.documentKind,
  target.expectedRevision,
  ...(target.kind === "draft" ? [target.draftId, target.generation] : []),
];
