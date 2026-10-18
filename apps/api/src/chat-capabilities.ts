/**
 * Shared chat capability primitives.
 *
 * This is the leaf module for the new foundation schemas: exact installed
 * reasoning levels, the catalog model identity shape, model selection, the
 * authoritative default and the typed failure codes. It deliberately does not
 * import chat-model.ts, because a future snapshot extension may make that
 * module depend on these contracts; duplicating the bounded UUID pattern
 * avoids a cycle while staying type-compatible with the existing ChatId and
 * OperationId strings.
 */
import { Schema } from "effect";

/** Bounded UUID shared by the new foundation modules. Existing chat-model.ts keeps its own. */
export const DomainUuid = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
);
export type DomainUuid = typeof DomainUuid.Type;

/** The one registered chat provider. Another provider is invalid input, not a fallback. */
export const CHAT_PROVIDER = "cloudflare" as const;

/** Exact installed reasoning levels, ordered lowest to highest. */
export const CHAT_EFFORTS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const ChatEffort = Schema.Literals(CHAT_EFFORTS);
export type ChatEffort = typeof ChatEffort.Type;

/** Catalog specifier `<gateway slug>/<vendor id>`, for example openai/gpt-6-luna. */
export const ChatModelId = Schema.String.check(
  Schema.isPattern(/^(openai|anthropic)\/[a-z0-9][a-z0-9._-]{0,63}$/),
);
export type ChatModelId = typeof ChatModelId.Type;

export const ChatSelection = Schema.Struct({
  provider: Schema.Literal(CHAT_PROVIDER),
  model: ChatModelId,
  effort: ChatEffort,
});
export type ChatSelection = typeof ChatSelection.Type;

/** Authoritative first-run selection; the installed catalog must still confirm it. */
export const DEFAULT_CHAT_MODEL: ChatModelId = "openai/gpt-6-luna";
export const DEFAULT_CHAT_EFFORT: ChatEffort = "high";
export const DEFAULT_CHAT_SELECTION: ChatSelection = {
  provider: CHAT_PROVIDER,
  model: DEFAULT_CHAT_MODEL,
  effort: DEFAULT_CHAT_EFFORT,
};

export const CHAT_SELECTION_FAILURES = [
  "invalid_input",
  "unknown_model",
  "stage_unconfigured",
  "model_not_enabled",
  "unsupported_effort",
  "remembered_effort_unsupported",
  "capability_unavailable",
] as const;
export const ChatSelectionFailure = Schema.Literals(CHAT_SELECTION_FAILURES);
export type ChatSelectionFailure = typeof ChatSelectionFailure.Type;

export const CHAT_ADJUSTMENT_REASONS = ["unsupported_effort", "model_first_use"] as const;
export const ChatEffortAdjustment = Schema.Struct({
  requested: ChatEffort,
  applied: ChatEffort,
  reason: Schema.Literals(CHAT_ADJUSTMENT_REASONS),
});
export type ChatEffortAdjustment = typeof ChatEffortAdjustment.Type;

/** Saved choices versus initial application defaults. */
export const PreferenceSource = Schema.Literals(["explicit", "default"]);
export type PreferenceSource = typeof PreferenceSource.Type;

/** Canonical stored timestamp, exactly the shape Date#toISOString produces. */
export const IsoTimestamp = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  Schema.makeFilter((value) => {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }),
);
export type IsoTimestamp = typeof IsoTimestamp.Type;

/** Reads an unknown installed-metadata field without a narrowing assertion. */
export const readField = (value: unknown, key: string): unknown => {
  if (typeof value !== "object" || value === null) return undefined;
  const property: unknown = Reflect.get(value, key);
  return property;
};

const Money = Schema.Number.check(
  Schema.makeFilter((value) => Number.isFinite(value) && value >= 0),
);
const TokenCount = Schema.Number.check(
  Schema.makeFilter((value) => Number.isSafeInteger(value) && value > 0),
);
const CostRates = { input: Money, output: Money, cacheRead: Money, cacheWrite: Money } as const;

/** Catalog list prices in US dollars per million tokens; not a billing statement. */
export const ChatPricing = Schema.Struct({
  ...CostRates,
  tiers: Schema.Array(Schema.Struct({ aboveInputTokens: TokenCount, ...CostRates })).check(
    Schema.isMaxLength(4),
  ),
});
export type ChatPricing = typeof ChatPricing.Type;

export const ChatImageResize = Schema.Struct({
  maxWidth: TokenCount,
  maxHeight: TokenCount,
  maxBytes: TokenCount,
});
export type ChatImageResize = typeof ChatImageResize.Type;

export const CHAT_GROUPS = ["openai", "anthropic"] as const;
export const ChatGroup = Schema.Literals(CHAT_GROUPS);
export type ChatGroup = typeof ChatGroup.Type;

/** Serializable catalog metadata; safe for the authenticated browser projection. */
export const ChatCatalogModel = Schema.Struct({
  provider: Schema.Literal(CHAT_PROVIDER),
  group: ChatGroup,
  api: Schema.Literals(["openai-responses", "anthropic-messages"]),
  model: ChatModelId,
  vendorId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64)),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  imageInput: Schema.Boolean,
  contextWindow: TokenCount,
  maxOutputTokens: TokenCount,
  reasoning: Schema.Boolean,
  efforts: Schema.Array(ChatEffort).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(CHAT_EFFORTS.length),
  ),
  pricing: ChatPricing,
  imageResize: Schema.NullOr(ChatImageResize),
});
export type ChatCatalogModel = typeof ChatCatalogModel.Type;
