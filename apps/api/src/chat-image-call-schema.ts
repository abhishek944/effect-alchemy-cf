import type { ImageMetadata } from "@abhishek944/pi-image-gen/core";
import { Schema } from "effect";
import { SavedFile } from "./chat-library-schema.ts";
import { ImageCallAdmission } from "./chat-image-call-evidence.ts";
import { ImageCallCost, ImageCallMetadata } from "./chat-image-call-metadata.ts";
import {
  CallAmount,
  CallIndex,
  CALL_EVIDENCE_BYTES,
  CALL_STATE_BYTES,
  CALL_SUMMARY_BYTES,
  callFitsJson,
  callJson,
} from "./chat-image-call-values.ts";
export { ImageCallAdmission, NativeImageCallArgs } from "./chat-image-call-evidence.ts";
export { ImageCallCost, ImageCallMetadata } from "./chat-image-call-metadata.ts";

export const ImageCallOutcome = Schema.Struct({
  dispatched: Schema.Boolean,
  uncertain: Schema.Boolean,
  storageUncertain: Schema.Boolean,
  partial: Schema.Boolean,
}).check(
  Schema.makeFilter(
    (outcome) =>
      outcome.dispatched || !(outcome.uncertain || outcome.storageUncertain || outcome.partial),
  ),
);
export const ImageCallState = Schema.Struct({
  status: Schema.Literals(["prepared", "started", "complete", "failed", "unresolved"]),
  started: Schema.Boolean,
  dispatched: Schema.Boolean,
  failureLatched: Schema.Boolean,
  /** Private owner-RPC acknowledgment debt, independent of provider outcome/cost. */
  ownerFinalizationPending: Schema.Boolean,
  outcome: ImageCallOutcome,
  metadata: Schema.NullOr(ImageCallMetadata),
  cost: ImageCallCost,
  outputCount: CallIndex,
}).check(
  Schema.makeFilter(
    (state) =>
      (!state.dispatched || state.started) &&
      (!state.failureLatched || state.dispatched) &&
      (!(["failed", "unresolved"].includes(state.status) && state.dispatched) ||
        state.failureLatched) &&
      (state.dispatched ||
        state.metadata === null ||
        (state.metadata.outputs.length === 0 && state.metadata.cost.kind === "unknown")) &&
      state.outcome.dispatched === state.dispatched &&
      (state.status !== "prepared" || (!state.started && !state.dispatched)) &&
      (state.status !== "started" || state.started) &&
      (state.status !== "complete" ||
        (state.started &&
          state.dispatched &&
          state.metadata !== null &&
          state.metadata.outputs.length > 0 &&
          state.outputCount === state.metadata.outputs.length &&
          !state.outcome.uncertain &&
          !state.outcome.storageUncertain)) &&
      (state.outputCount === 0 || (state.started && state.dispatched)),
  ),
  Schema.makeFilter(
    (state) =>
      callFitsJson(state, CALL_STATE_BYTES) &&
      (state.metadata === null
        ? state.cost.kind === "unknown"
        : callJson(state.cost, CALL_STATE_BYTES) ===
          callJson(state.metadata.cost, CALL_STATE_BYTES)),
  ),
);
export type ImageCallState = typeof ImageCallState.Type;
export const ImageCallView = Schema.Struct({
  admission: ImageCallAdmission,
  ...ImageCallState.fields,
}).check(
  Schema.makeFilter((view) => {
    const { admission, ...state } = view;
    return Schema.is(ImageCallState)(state) && callFitsJson(admission, CALL_EVIDENCE_BYTES);
  }),
);
export type ImageCallView = typeof ImageCallView.Type;
export const ImageCallFile = Schema.Struct({ index: CallIndex, file: SavedFile });
export type ImageCallFile = typeof ImageCallFile.Type;
export const ImageCallRecord = Schema.Struct({
  status: Schema.Literals(["complete", "failed", "unresolved"]),
  outcome: ImageCallOutcome,
  metadata: Schema.optionalKey(ImageCallMetadata),
  files: Schema.Array(ImageCallFile),
}).check(Schema.makeFilter((update) => callFitsJson(update, CALL_STATE_BYTES)));
export type ImageCallUpdate = Omit<typeof ImageCallRecord.Type, "metadata"> & {
  readonly metadata?: ImageMetadata;
};

export const AssistantSavedFilesPage = Schema.Struct({
  messageId: Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,15}:(0|[1-9][0-9]{0,15})$/)),
  files: Schema.Array(SavedFile).check(Schema.isMaxLength(30)),
  nextCursor: Schema.NullOr(Schema.String.check(Schema.isMaxLength(2048))),
}).check(Schema.makeFilter((page) => callFitsJson(page, CALL_SUMMARY_BYTES)));
export type AssistantSavedFilesPage = typeof AssistantSavedFilesPage.Type;
export const ImageUsageSummary = Schema.Struct({
  callCount: CallIndex,
  startedCalls: CallIndex,
  dispatchedCalls: CallIndex,
  notDispatchedCalls: CallIndex,
  reportedUsd: CallAmount,
  estimatedUsd: CallAmount,
  partialEstimatedUsd: CallAmount,
  unknownCalls: CallIndex,
  partialCalls: CallIndex,
  otherCurrencyCalls: CallIndex,
  completeness: Schema.Literals(["complete", "partial", "unknown"]),
  recent: Schema.Array(ImageCallView).check(Schema.isMaxLength(10)),
}).check(Schema.makeFilter((summary) => callFitsJson(summary, CALL_SUMMARY_BYTES)));
export type ImageUsageSummary = typeof ImageUsageSummary.Type;
