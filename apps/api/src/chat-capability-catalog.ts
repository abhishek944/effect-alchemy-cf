/**
 * Installed Cloudflare OpenAI and Anthropic chat model catalog.
 *
 * Metadata is derived at module load from the pinned @earendil-works/pi-ai
 * 1.1.0 Cloudflare AI Gateway catalog and the native
 * `getSupportedThinkingLevels` rule. Nothing here calls a provider, reads a
 * credential or touches the network. List prices are catalog values, never
 * account billing proof. An entry whose installed metadata is incomplete is
 * excluded instead of guessed.
 */
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import { CLOUDFLARE_AI_GATEWAY_MODELS } from "@earendil-works/pi-ai/providers/cloudflare-ai-gateway.models";
import {
  CHAT_PROVIDER,
  DEFAULT_CHAT_EFFORT,
  DEFAULT_CHAT_MODEL,
  readField,
  type ChatCatalogModel,
  type ChatGroup,
  type ChatImageResize,
  type ChatModelId,
  type ChatPricing,
} from "./chat-capabilities.ts";

type CatalogEntry =
  (typeof CLOUDFLARE_AI_GATEWAY_MODELS)[keyof typeof CLOUDFLARE_AI_GATEWAY_MODELS];

const rate = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const count = (value: unknown): number | null =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
const groupOf = (baseUrl: string): ChatGroup | null => {
  const slug = baseUrl.split("/").at(-1);
  return slug === "openai" || slug === "anthropic" ? slug : null;
};

type CostTier = {
  aboveInputTokens: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

const tierOf = (value: unknown): CostTier | null => {
  const aboveInputTokens = count(readField(value, "inputTokensAbove"));
  const input = rate(readField(value, "input"));
  const output = rate(readField(value, "output"));
  const cacheRead = rate(readField(value, "cacheRead"));
  const cacheWrite = rate(readField(value, "cacheWrite"));
  return aboveInputTokens === null ||
    input === null ||
    output === null ||
    cacheRead === null ||
    cacheWrite === null
    ? null
    : { aboveInputTokens, input, output, cacheRead, cacheWrite };
};

const pricingOf = (value: unknown): ChatPricing | null => {
  const input = rate(readField(value, "input"));
  const output = rate(readField(value, "output"));
  const cacheRead = rate(readField(value, "cacheRead"));
  const cacheWrite = rate(readField(value, "cacheWrite"));
  if (input === null || output === null || cacheRead === null || cacheWrite === null) return null;
  const tiers: CostTier[] = [];
  const rawTiers = readField(value, "tiers");
  if (rawTiers !== undefined) {
    if (!Array.isArray(rawTiers) || rawTiers.length > 4) return null;
    for (const rawTier of rawTiers) {
      const tier = tierOf(rawTier);
      if (tier === null) return null;
      tiers.push(tier);
    }
  }
  return { input, output, cacheRead, cacheWrite, tiers };
};

/** `null` means no resize metadata; "invalid" means partial metadata, so the model is excluded. */
const resizeOf = (value: unknown): ChatImageResize | null | "invalid" => {
  const resize = readField(readField(value, "images"), "resize");
  if (typeof resize !== "object" || resize === null) return null;
  const maxWidth = count(readField(resize, "maxWidth"));
  const maxHeight = count(readField(resize, "maxHeight"));
  const maxBytes = count(readField(resize, "maxBytes"));
  if (maxWidth === null || maxHeight === null || maxBytes === null) return "invalid";
  return { maxWidth, maxHeight, maxBytes };
};

const describe = (group: ChatGroup, model: CatalogEntry): ChatCatalogModel | null => {
  if (model.api !== "openai-responses" && model.api !== "anthropic-messages") return null;
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(model.id)) return null;
  const contextWindow = count(model.contextWindow);
  const maxOutputTokens = count(model.maxTokens);
  const input = Array.isArray(model.input) ? model.input : [];
  const pricing = pricingOf(model.cost);
  const imageResize = resizeOf(model.inputLimits);
  const efforts = getSupportedThinkingLevels(model);
  if (
    contextWindow === null ||
    maxOutputTokens === null ||
    pricing === null ||
    imageResize === "invalid" ||
    !input.includes("text") ||
    efforts.length === 0
  )
    return null;
  return {
    provider: CHAT_PROVIDER,
    group,
    api: model.api,
    model: `${group}/${model.id}`,
    vendorId: model.id,
    name: model.name,
    imageInput: input.includes("image"),
    contextWindow,
    maxOutputTokens,
    reasoning: model.reasoning,
    efforts,
    pricing,
    imageResize,
  };
};

const installed: readonly ChatCatalogModel[] = (() => {
  const models: ChatCatalogModel[] = [];
  for (const model of Object.values(CLOUDFLARE_AI_GATEWAY_MODELS)) {
    const group = groupOf(model.baseUrl);
    if (group === null) continue;
    const described = describe(group, model);
    if (described !== null) models.push(described);
  }
  models.sort((left, right) =>
    left.group === right.group
      ? left.name.localeCompare(right.name, "en")
      : left.group === "openai"
        ? -1
        : 1,
  );
  return Object.freeze(models);
})();

const installedById = new Map(installed.map((model) => [model.model, model]));

/** Every installed OpenAI and Anthropic chat model, sorted by group then name. */
export const installedChatCatalog = (): readonly ChatCatalogModel[] => installed;
export const installedChatModel = (model: ChatModelId): ChatCatalogModel | null =>
  installedById.get(model) ?? null;

const defaultModel = installedById.get(DEFAULT_CHAT_MODEL);
if (defaultModel === undefined || !defaultModel.efforts.includes(DEFAULT_CHAT_EFFORT)) {
  throw new Error(
    `Installed chat catalog does not offer ${DEFAULT_CHAT_MODEL} with ${DEFAULT_CHAT_EFFORT}.`,
  );
}
