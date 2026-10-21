import { isRecord } from "./chat-validate-base";
import {
  imageAmount,
  imageCount,
  imageJsonFits,
  imagePositive,
  imageReportedUsage,
  imageText,
} from "./image-usage-guards";
import { parseImageCost } from "./image-usage-cost";
import type { ImageCallMetadata, ImageOutputMetadata } from "./image-usage-types";

export function parseImageMetadata(value: unknown): ImageCallMetadata | null {
  if (!isRecord(value) || !imageJsonFits(value, 65_536)) return null;
  if (!imageText(value.model) || !imageText(value.provider) || !imageAmount(value.durationMs))
    return null;
  const cost = parseImageCost(value.cost);
  if (!cost || !Array.isArray(value.outputs)) return null;
  if (
    value.requestId !== undefined &&
    (typeof value.requestId !== "string" || !/^[A-Za-z0-9._:/-]{1,200}$/.test(value.requestId))
  )
    return null;
  if (value.reportedUsage !== undefined && !imageReportedUsage(value.reportedUsage)) return null;
  if (value.quality !== undefined && !imageText(value.quality)) return null;
  if (value.size !== undefined && !imageText(value.size)) return null;
  const outputs: ImageOutputMetadata[] = [];
  const indices = new Set<number>();
  for (const item of value.outputs) {
    if (
      !isRecord(item) ||
      !imageCount(item.index) ||
      !imageText(item.mimeType) ||
      !imagePositive(item.bytes) ||
      indices.has(item.index)
    )
      return null;
    if (item.width !== undefined && !imagePositive(item.width)) return null;
    if (item.height !== undefined && !imagePositive(item.height)) return null;
    if (
      item.revisedPrompt !== undefined &&
      (typeof item.revisedPrompt !== "string" || item.revisedPrompt.length > 32_000)
    )
      return null;
    indices.add(item.index);
    // Revised provider text is validated but deliberately neither retained nor displayed.
    outputs.push({
      index: item.index,
      mimeType: item.mimeType,
      bytes: item.bytes,
      ...(item.width === undefined ? {} : { width: item.width }),
      ...(item.height === undefined ? {} : { height: item.height }),
    });
  }
  return {
    model: value.model,
    provider: value.provider,
    durationMs: value.durationMs,
    cost,
    outputs,
    ...(value.requestId === undefined ? {} : { requestId: value.requestId }),
    ...(value.reportedUsage === undefined ? {} : { reportedUsage: value.reportedUsage }),
    ...(value.quality === undefined ? {} : { quality: value.quality }),
    ...(value.size === undefined ? {} : { size: value.size }),
  };
}
