/**
 * Manual validators for the chat catalog projection.
 *
 * Every parser rejects malformed, overlong or inconsistent data by returning
 * null, matching the existing browser validation style and the server schemas.
 * Sibling capability validators reuse the exported primitives below.
 */
import type {
  ChatCatalog,
  ChatCatalogEntry,
  ChatCatalogModel,
  ChatEffort,
  ChatEffortAdjustment,
  ChatImageResize,
  ChatModelAvailability,
  ChatPricing,
  ChatPricingTier,
  ChatSelection,
} from "@/lib/chat-capability-types";
import { CHAT_EFFORTS, STAGE_MODEL_LIMIT } from "@/lib/chat-capability-types";
import { isRecord, isText } from "@/lib/chat-validate-base";

export { CHAT_EFFORTS, MODEL_EFFORT_LIMIT, STAGE_MODEL_LIMIT } from "@/lib/chat-capability-types";

const modelIdPattern = /^(openai|anthropic)\/[a-z0-9][a-z0-9._-]{0,63}$/;
const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const isChatEffort = (value: unknown): value is ChatEffort =>
  isText(value) && (CHAT_EFFORTS as readonly string[]).includes(value);

export const isChatModelId = (value: unknown): value is string =>
  isText(value) && modelIdPattern.test(value);

/** Server-stored canonical timestamp; the browser never invents one. */
export const isIsoTimestamp = (value: unknown): value is string => {
  if (!isText(value) || !timestampPattern.test(value)) return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
};

export const isSafeCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

export const isPositiveCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0;

export const isNonNegativeNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

export const isBoundedText = (value: unknown, max: number): value is string =>
  isText(value) && value.length <= max;

/** Shared type-safe literal lookup; avoids narrowing assertions. */
export const listed = <T extends string>(values: readonly T[], value: unknown): value is T =>
  values.find((candidate) => candidate === value) !== undefined;

export function parseChatSelection(value: unknown): ChatSelection | null {
  if (!isRecord(value) || value.provider !== "cloudflare") return null;
  if (!isChatModelId(value.model) || !isChatEffort(value.effort)) return null;
  return { provider: "cloudflare", model: value.model, effort: value.effort };
}

export function parseChatEffortAdjustment(value: unknown): ChatEffortAdjustment | null {
  if (!isRecord(value)) return null;
  if (!isChatEffort(value.requested) || !isChatEffort(value.applied)) return null;
  if (value.reason !== "unsupported_effort" && value.reason !== "model_first_use") return null;
  return { requested: value.requested, applied: value.applied, reason: value.reason };
}

function parsePricingTier(value: unknown): ChatPricingTier | null {
  if (!isRecord(value) || !isPositiveCount(value.aboveInputTokens)) return null;
  if (
    !isNonNegativeNumber(value.input) ||
    !isNonNegativeNumber(value.output) ||
    !isNonNegativeNumber(value.cacheRead) ||
    !isNonNegativeNumber(value.cacheWrite)
  )
    return null;
  return {
    aboveInputTokens: value.aboveInputTokens,
    input: value.input,
    output: value.output,
    cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite,
  };
}

export function parseChatPricing(value: unknown): ChatPricing | null {
  if (!isRecord(value)) return null;
  if (
    !isNonNegativeNumber(value.input) ||
    !isNonNegativeNumber(value.output) ||
    !isNonNegativeNumber(value.cacheRead) ||
    !isNonNegativeNumber(value.cacheWrite)
  )
    return null;
  if (!Array.isArray(value.tiers) || value.tiers.length > 4) return null;
  const tiers: ChatPricingTier[] = [];
  for (const item of value.tiers) {
    const tier = parsePricingTier(item);
    if (!tier) return null;
    tiers.push(tier);
  }
  return {
    input: value.input,
    output: value.output,
    cacheRead: value.cacheRead,
    cacheWrite: value.cacheWrite,
    tiers,
  };
}

function parseImageResize(value: unknown): ChatImageResize | null | "invalid" {
  if (value === null) return null;
  if (!isRecord(value)) return "invalid";
  if (
    !isPositiveCount(value.maxWidth) ||
    !isPositiveCount(value.maxHeight) ||
    !isPositiveCount(value.maxBytes)
  )
    return "invalid";
  return { maxWidth: value.maxWidth, maxHeight: value.maxHeight, maxBytes: value.maxBytes };
}

function parseCatalogModel(value: unknown): ChatCatalogModel | null {
  if (!isRecord(value) || value.provider !== "cloudflare") return null;
  if (value.group !== "openai" && value.group !== "anthropic") return null;
  if (value.api !== "openai-responses" && value.api !== "anthropic-messages") return null;
  if (!isChatModelId(value.model) || !isText(value.vendorId) || !isText(value.name)) return null;
  if (value.vendorId.length < 1 || value.vendorId.length > 64) return null;
  if (value.name.length < 1 || value.name.length > 120) return null;
  if (value.model !== `${value.group}/${value.vendorId}`) return null;
  if (typeof value.imageInput !== "boolean" || typeof value.reasoning !== "boolean") return null;
  if (!isPositiveCount(value.contextWindow) || !isPositiveCount(value.maxOutputTokens)) return null;
  if (!Array.isArray(value.efforts) || value.efforts.length < 1) return null;
  if (value.efforts.length > CHAT_EFFORTS.length) return null;
  const efforts: ChatEffort[] = [];
  for (const effort of value.efforts) {
    if (!isChatEffort(effort) || efforts.includes(effort)) return null;
    efforts.push(effort);
  }
  const pricing = parseChatPricing(value.pricing);
  if (!pricing) return null;
  const imageResize = parseImageResize(value.imageResize);
  if (imageResize === "invalid") return null;
  return {
    provider: "cloudflare",
    group: value.group,
    api: value.api,
    model: value.model,
    vendorId: value.vendorId,
    name: value.name,
    imageInput: value.imageInput,
    contextWindow: value.contextWindow,
    maxOutputTokens: value.maxOutputTokens,
    reasoning: value.reasoning,
    efforts,
    pricing,
    imageResize,
  };
}

const isAvailability = (value: unknown): value is ChatModelAvailability =>
  value === "enabled" || value === "not_enabled" || value === "stage_unconfigured";

export function parseChatCatalogEntry(value: unknown): ChatCatalogEntry | null {
  const model = parseCatalogModel(value);
  if (!model || !isRecord(value)) return null;
  if (!isAvailability(value.availability)) return null;
  if (value.accountEligibility !== "unverified") return null;
  return { ...model, availability: value.availability, accountEligibility: "unverified" };
}

export function parseChatCatalog(value: unknown): ChatCatalog | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1 || typeof value.stageConfigured !== "boolean") return null;
  const defaultSelection = parseChatSelection(value.defaultSelection);
  if (!defaultSelection) return null;
  if (!Array.isArray(value.models) || value.models.length > STAGE_MODEL_LIMIT) return null;
  const models: ChatCatalogEntry[] = [];
  for (const item of value.models) {
    const entry = parseChatCatalogEntry(item);
    if (!entry) return null;
    if (models.some((other) => other.model === entry.model)) return null;
    if (!value.stageConfigured && entry.availability !== "stage_unconfigured") return null;
    if (value.stageConfigured && entry.availability === "stage_unconfigured") return null;
    models.push(entry);
  }
  if (!models.some((entry) => entry.model === defaultSelection.model)) return null;
  return { version: 1, stageConfigured: value.stageConfigured, defaultSelection, models };
}
