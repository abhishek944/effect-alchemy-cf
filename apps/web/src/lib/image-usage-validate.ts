import { isRecord } from "./chat-validate-base";
import { imageAmount, imageCount, imageJsonFits, nativeImageMessageId } from "./image-usage-guards";
import { parseImageCost } from "./image-usage-cost";
import { parseImageMetadata } from "./image-usage-metadata";
import type { ImageCallPresentation, ImageUsagePresentation } from "./image-usage-types";

function parseCall(value: unknown): ImageCallPresentation | null {
  if (
    !isRecord(value) ||
    typeof value.callId !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.callId) ||
    !nativeImageMessageId(value.messageId)
  )
    return null;
  if (
    value.status !== "prepared" &&
    value.status !== "started" &&
    value.status !== "complete" &&
    value.status !== "failed" &&
    value.status !== "unresolved"
  )
    return null;
  if (
    !imageCount(value.outputCount) ||
    typeof value.dispatched !== "boolean" ||
    typeof value.uncertain !== "boolean" ||
    typeof value.storageUncertain !== "boolean" ||
    typeof value.partial !== "boolean"
  )
    return null;
  const cost = parseImageCost(value.cost);
  const metadata = value.metadata === null ? null : parseImageMetadata(value.metadata);
  if (!cost || (value.metadata !== null && !metadata)) return null;
  return {
    callId: value.callId,
    messageId: value.messageId,
    status: value.status,
    dispatched: value.dispatched,
    outputCount: value.outputCount,
    uncertain: value.uncertain,
    storageUncertain: value.storageUncertain,
    partial: value.partial,
    cost,
    metadata,
  };
}

/** Lifetime sums are server-authoritative, never reconstructed from bounded recent rows. */
export function parseImageUsage(value: unknown, messageId?: string): ImageUsagePresentation | null {
  if (!isRecord(value) || !imageJsonFits(value, 131_072)) return null;
  if (
    !imageCount(value.callCount) ||
    !imageCount(value.startedCalls) ||
    !imageCount(value.dispatchedCalls) ||
    !imageCount(value.notDispatchedCalls)
  )
    return null;
  if (
    !imageAmount(value.reportedUsd) ||
    !imageAmount(value.estimatedUsd) ||
    !imageAmount(value.partialEstimatedUsd)
  )
    return null;
  if (
    !imageCount(value.unknownCalls) ||
    !imageCount(value.partialCalls) ||
    !imageCount(value.otherCurrencyCalls)
  )
    return null;
  if (
    value.completeness !== "complete" &&
    value.completeness !== "partial" &&
    value.completeness !== "unknown"
  )
    return null;
  if (
    !Array.isArray(value.recent) ||
    value.recent.length > 10 ||
    value.recent.length > value.callCount
  )
    return null;
  if (
    value.startedCalls > value.callCount ||
    value.dispatchedCalls > value.startedCalls ||
    value.partialCalls > value.callCount
  )
    return null;
  const known =
    value.callCount - value.unknownCalls - value.otherCurrencyCalls - value.notDispatchedCalls;
  if (!imageCount(known)) return null;
  if (
    known === 0 &&
    (value.reportedUsd !== 0 || value.estimatedUsd !== 0 || value.partialEstimatedUsd !== 0)
  )
    return null;
  const incomplete =
    value.unknownCalls > 0 || value.otherCurrencyCalls > 0 || value.partialCalls > 0;
  const completeness = incomplete ? (known === 0 ? "unknown" : "partial") : "complete";
  if (value.completeness !== completeness) return null;
  const recent: ImageCallPresentation[] = [];
  const ids = new Set<string>();
  for (const item of value.recent) {
    const call = parseCall(item);
    if (!call || ids.has(call.callId) || (messageId !== undefined && call.messageId !== messageId))
      return null;
    ids.add(call.callId);
    recent.push(call);
  }
  return {
    callCount: value.callCount,
    startedCalls: value.startedCalls,
    dispatchedCalls: value.dispatchedCalls,
    notDispatchedCalls: value.notDispatchedCalls,
    reportedUsd: value.reportedUsd,
    estimatedUsd: value.estimatedUsd,
    partialEstimatedUsd: value.partialEstimatedUsd,
    unknownCalls: value.unknownCalls,
    partialCalls: value.partialCalls,
    otherCurrencyCalls: value.otherCurrencyCalls,
    completeness,
    recent,
  };
}
