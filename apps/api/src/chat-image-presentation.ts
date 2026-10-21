import { Schema } from "effect";
import {
  ImageCallCost,
  ImageCallMetadata,
  ImageUsageSummary,
  type ImageUsageSummary as PrivateImageUsage,
  type ImageCallView,
} from "./chat-image-call-schema.ts";
import { CALL_SUMMARY_BYTES, callFitsJson } from "./chat-image-call-values.ts";

/** Presentation only: never expose admission prompts, native tasks or canonical routes. */
export const ImageCallPresentation = Schema.Struct({
  callId: Schema.String,
  messageId: Schema.String,
  status: Schema.Literals(["prepared", "started", "complete", "failed", "unresolved"]),
  dispatched: Schema.Boolean,
  outputCount: Schema.Number,
  uncertain: Schema.Boolean,
  storageUncertain: Schema.Boolean,
  partial: Schema.Boolean,
  cost: ImageCallCost,
  metadata: Schema.NullOr(ImageCallMetadata),
});
export const ImageUsagePresentation = Schema.Struct({
  ...ImageUsageSummary.fields,
  recent: Schema.Array(ImageCallPresentation).check(Schema.isMaxLength(10)),
}).check(Schema.makeFilter((value) => callFitsJson(value, CALL_SUMMARY_BYTES)));
export type ImageUsagePresentation = typeof ImageUsagePresentation.Type;

/** Budget AFTER redaction: private prompt length must not suppress small public cost evidence. */
export const presentImageUsage = (
  totals: Omit<PrivateImageUsage, "recent">,
  calls: readonly ImageCallView[],
): ImageUsagePresentation => {
  const recent: (typeof ImageCallPresentation.Type)[] = [];
  for (const call of calls.slice(0, 10)) {
    const presented = {
      callId: call.admission.key,
      messageId: `${call.admission.assistantEntryId}:${call.admission.modelIndex}`,
      status: call.status,
      outputCount: call.outputCount,
      ...call.outcome,
      cost: call.cost,
      metadata: call.metadata,
    };
    if (callFitsJson({ ...totals, recent: [...recent, presented] }, CALL_SUMMARY_BYTES))
      recent.push(presented);
  }
  return Schema.decodeUnknownSync(ImageUsagePresentation)({ ...totals, recent });
};
