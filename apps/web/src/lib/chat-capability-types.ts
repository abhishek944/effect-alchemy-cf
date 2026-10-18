/**
 * Browser projection of the frozen chat capability contract.
 *
 * These types mirror the server schemas exactly and describe authenticated,
 * serializable JSON only: no credentials, provider clients, infrastructure or
 * storage keys. The catalog is installed metadata, and `accountEligibility`
 * stays "unverified" because static catalog presence is not Gateway
 * entitlement.
 */
export type ChatEffort = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/** Exact installed reasoning levels, ordered lowest to highest for pickers. */
export const CHAT_EFFORTS: readonly ChatEffort[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

export type ChatGroup = "openai" | "anthropic";
export const CHAT_GROUPS: readonly ChatGroup[] = ["openai", "anthropic"];
export type ChatApi = "openai-responses" | "anthropic-messages";

export type ChatSelection = {
  provider: "cloudflare";
  /** Catalog specifier, for example openai/gpt-6-luna. */
  model: string;
  effort: ChatEffort;
};

export type ChatPricingTier = {
  aboveInputTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

/** Catalog list prices in US dollars per million tokens; not a billing statement. */
export type ChatPricing = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  tiers: ChatPricingTier[];
};

export type ChatImageResize = { maxWidth: number; maxHeight: number; maxBytes: number };

export type ChatCatalogModel = {
  provider: "cloudflare";
  group: ChatGroup;
  api: ChatApi;
  model: string;
  vendorId: string;
  name: string;
  imageInput: boolean;
  contextWindow: number;
  maxOutputTokens: number;
  reasoning: boolean;
  /** Exact supported levels; an unsupported level is never offered. */
  efforts: ChatEffort[];
  pricing: ChatPricing;
  imageResize: ChatImageResize | null;
};

export type ChatModelAvailability = "enabled" | "not_enabled" | "stage_unconfigured";

export type ChatCatalogEntry = ChatCatalogModel & {
  /** Allowlist state, not account entitlement. */
  availability: ChatModelAvailability;
  /** Always unverified until an authorized live check proves eligibility. */
  accountEligibility: "unverified";
};

export type ChatCatalog = {
  version: 1;
  stageConfigured: boolean;
  defaultSelection: ChatSelection;
  models: ChatCatalogEntry[];
};

export const MODEL_EFFORT_LIMIT = 64;
export const STAGE_MODEL_LIMIT = 64;

export type ChatEffortAdjustment = {
  requested: ChatEffort;
  applied: ChatEffort;
  reason: "unsupported_effort" | "model_first_use";
};

export type PreferenceSource = "explicit" | "default";

export type ChatModelEffort = { model: string; effort: ChatEffort };

/** Preferred settings, distinct from the frozen active operation tuple. */
export type ChatPreferences = {
  version: 1;
  revision: number;
  preferred: ChatSelection;
  /** Bounded per-model memory, most recent first. */
  modelEfforts: ChatModelEffort[];
};

export type AccountChatPreferences = {
  version: 1;
  revision: number;
  /** Account new-chat default; only an explicit selection change updates it. */
  defaultSelection: ChatSelection;
};

export type ChatPreferencesView = {
  chatId: string;
  preferences: ChatPreferences;
  source: PreferenceSource;
};

export type AccountChatPreferencesView = {
  preferences: AccountChatPreferences;
  source: PreferenceSource;
};

export type ChatPreferencesWrite = {
  chatId: string;
  expectedRevision: number;
  selection: ChatSelection;
};

export type AccountChatPreferencesWrite = {
  expectedRevision: number;
  selection: ChatSelection;
};

export type ChatPreferencesWriteResult = {
  view: ChatPreferencesView;
  accountDefaultUpdated: boolean;
};

export type AccountChatPreferencesWriteResult = {
  view: AccountChatPreferencesView;
};

export type ChatSelectionFailure =
  | "invalid_input"
  | "unknown_model"
  | "stage_unconfigured"
  | "model_not_enabled"
  | "unsupported_effort"
  | "remembered_effort_unsupported"
  | "capability_unavailable";

export type PreferenceFailure = "invalid_input" | "revision_conflict";
