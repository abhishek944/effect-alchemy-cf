/**
 * T27 amount rules: installed-catalog list-price estimates using the SDK's own
 * tier rule, and the conversion of one provider response into the authoritative
 * `UsageAmount`. Pure; no storage, provider or harness access.
 */
import { installedChatModel } from "./chat-capability-catalog.ts";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ChatModelId, ChatPricing } from "./chat-capabilities.ts";
import type { AccountingAmount } from "./chat-accounting-model.ts";
import { emptyCounters, messageModelId, unknownAmount } from "./chat-accounting-model.ts";
import type { NativeUsage } from "./chat-accounting-counters.ts";
import { countersOfUsage, nativeCostOf, reportedUsage } from "./chat-accounting-counters.ts";
import type { TokenCounters, UsageAmount } from "./chat-usage-schema.ts";

type CostRates = Pick<ChatPricing, "input" | "output" | "cacheRead" | "cacheWrite">;

const ratesFor = (pricing: ChatPricing, inputTokens: number): CostRates => {
  let rates: CostRates = pricing;
  let matched = -1;
  for (const tier of pricing.tiers) {
    if (inputTokens > tier.aboveInputTokens && tier.aboveInputTokens > matched) {
      rates = tier;
      matched = tier.aboveInputTokens;
    }
  }
  return rates;
};

/** Installed-catalog list-price estimate; mirrors the SDK's own tier rule. */
export const costOfUsage = (pricing: ChatPricing, usage: NativeUsage): number => {
  const rates = ratesFor(pricing, usage.input + usage.cacheRead + usage.cacheWrite);
  const longWrite = usage.cacheWrite1h ?? 0;
  const shortWrite = Math.max(0, usage.cacheWrite - longWrite);
  return (
    (rates.input * usage.input + rates.output * usage.output + rates.cacheRead * usage.cacheRead) /
      1_000_000 +
    (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1_000_000
  );
};

/** Aggregate-priced base rate for native buckets whose SDK cost is unavailable. */
export const costOfCounters = (pricing: ChatPricing, counters: TokenCounters): number | null => {
  if (
    counters.inputUncached === null ||
    counters.output === null ||
    counters.cacheRead === null ||
    counters.cacheWrite === null
  )
    return null;
  return (
    (pricing.input * counters.inputUncached +
      pricing.output * counters.output +
      pricing.cacheRead * counters.cacheRead +
      pricing.cacheWrite * counters.cacheWrite) /
    1_000_000
  );
};

export const pricingOfModel = (model: ChatModelId | null): ChatPricing | null =>
  model === null ? null : (installedChatModel(model)?.pricing ?? null);

/** Actual counters plus a catalog estimate; all-zero absent usage stays Unknown. */
export const amountOfUsage = (
  usage: NativeUsage | null,
  model: ChatModelId | null,
  fallbackModel: ChatModelId | null,
): AccountingAmount => {
  if (usage === null || !reportedUsage(usage)) return unknownAmount();
  const counters = countersOfUsage(usage);
  const pricing = pricingOfModel(model ?? fallbackModel);
  const nativeCost = nativeCostOf(usage);
  const estimatedCostUsd = pricing === null ? nativeCost : costOfUsage(pricing, usage);
  return {
    provenance: "reported",
    completeness:
      counters.inputUncached !== null &&
      counters.inputReported !== null &&
      counters.output !== null &&
      estimatedCostUsd !== null
        ? "complete"
        : "partial",
    counters,
    estimatedCostUsd,
  };
};

export const toUsageAmount = (amount: AccountingAmount): UsageAmount =>
  amount.provenance === "unknown"
    ? {
        provenance: "unknown",
        completeness: "unknown",
        tokens: emptyCounters(),
        estimatedCostUsd: null,
      }
    : {
        provenance: amount.provenance,
        completeness: amount.completeness,
        tokens: amount.counters ?? emptyCounters(),
        estimatedCostUsd: amount.estimatedCostUsd,
      };

/**
 * Pure per-message facts for the public transcript: the actual native response
 * model and usage govern the amount, never the current chat preference. An
 * all-zero SDK usage stays Unknown; a failed/aborted response with nonzero
 * actual usage keeps its reported counters.
 */
export const messageUsage = (message: AssistantMessage): UsageAmount =>
  toUsageAmount(amountOfUsage(message.usage, messageModelId(message), null));
