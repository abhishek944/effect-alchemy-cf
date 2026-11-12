/** Gateway-only availability; installed metadata enriches capabilities, never entitlement. */
import { gatewayCatalogSnapshot } from "./chat-gateway-catalog.ts";
import { Option, Schema } from "effect";
import { installedChatCatalog, installedChatModel } from "./chat-capability-catalog.ts";
import {
  CHAT_EFFORTS,
  CHAT_PROVIDER,
  ChatCatalogModel,
  ChatModelId,
  ChatSelection,
  DEFAULT_CHAT_EFFORT,
  DEFAULT_CHAT_SELECTION,
  type ChatEffort,
  type ChatEffortAdjustment,
  type ChatSelectionFailure,
} from "./chat-capabilities.ts";

/** Synchronous view of the permitted gateway catalog, not manual configuration. */
export const StageModelPolicy = Schema.Union([
  Schema.Struct({ availability: Schema.Literal("unconfigured") }),
  Schema.Struct({
    availability: Schema.Literal("configured"),
    enabled: Schema.Array(ChatModelId),
  }),
]);
export type StageModelPolicy = typeof StageModelPolicy.Type;

export type ChatModelAvailability = "enabled" | "not_enabled" | "stage_unconfigured";

export const chatModelAvailability = (
  policy: StageModelPolicy,
  model: ChatModelId,
): ChatModelAvailability =>
  policy.availability === "unconfigured"
    ? "stage_unconfigured"
    : policy.enabled.includes(model)
      ? "enabled"
      : "not_enabled";

export type ChatSelectionResolution =
  | { readonly ok: true; readonly selection: ChatSelection; readonly model: ChatCatalogModel }
  | { readonly ok: false; readonly code: ChatSelectionFailure };

/** Decodes a candidate selection and resolves it against catalog and stage policy. */
export const resolveChatSelection = (
  policy: StageModelPolicy,
  input: unknown,
): ChatSelectionResolution => {
  const selection = Option.getOrNull(Schema.decodeUnknownOption(ChatSelection)(input));
  if (selection === null) return { ok: false, code: "invalid_input" };
  return resolveChatSelectionValue(policy, selection);
};

/** Resolves an already decoded selection without observing a default. */
export const resolveChatSelectionValue = (
  policy: StageModelPolicy,
  selection: ChatSelection,
): ChatSelectionResolution => {
  const model = installedChatModel(selection.model);
  if (model === null) return { ok: false, code: "unknown_model" };
  const availability = chatModelAvailability(policy, selection.model);
  if (availability === "stage_unconfigured") return { ok: false, code: "stage_unconfigured" };
  if (availability === "not_enabled") return { ok: false, code: "model_not_enabled" };
  if (!model.efforts.includes(selection.effort)) return { ok: false, code: "unsupported_effort" };
  return { ok: true, selection, model };
};

/** Highest supported level at or below `preferred`; never moves above it. */
export const effortAtOrBelow = (
  efforts: readonly ChatEffort[],
  preferred: ChatEffort,
): ChatEffort | null => {
  for (let index = CHAT_EFFORTS.indexOf(preferred); index >= 0; index -= 1) {
    const candidate = CHAT_EFFORTS[index];
    if (candidate !== undefined && efforts.includes(candidate)) return candidate;
  }
  return null;
};

export type ChatModelResolution =
  | {
      readonly ok: true;
      readonly selection: ChatSelection;
      readonly model: ChatCatalogModel;
      readonly adjustment: ChatEffortAdjustment | null;
    }
  | { readonly ok: false; readonly code: ChatSelectionFailure };

/**
 * Resolves a model with no explicit effort. An unsupported remembered effort
 * returns `remembered_effort_unsupported` so the caller can show a correction
 * state and then call this function with `null`, which applies first-use policy
 * (prefer High, else the highest supported level at or below High) and reports
 * the `model_first_use` adjustment.
 */
export const resolveChatModelSelection = (
  policy: StageModelPolicy,
  model: ChatModelId,
  remembered: ChatEffort | null,
): ChatModelResolution => {
  const installed = installedChatModel(model);
  if (installed === null) return { ok: false, code: "unknown_model" };
  const availability = chatModelAvailability(policy, model);
  if (availability === "stage_unconfigured") return { ok: false, code: "stage_unconfigured" };
  if (availability === "not_enabled") return { ok: false, code: "model_not_enabled" };
  if (remembered !== null) {
    if (!installed.efforts.includes(remembered))
      return { ok: false, code: "remembered_effort_unsupported" };
    return {
      ok: true,
      selection: { provider: CHAT_PROVIDER, model, effort: remembered },
      model: installed,
      adjustment: null,
    };
  }
  const effort = effortAtOrBelow(installed.efforts, DEFAULT_CHAT_EFFORT);
  if (effort === null) return { ok: false, code: "capability_unavailable" };
  return {
    ok: true,
    selection: { provider: CHAT_PROVIDER, model, effort },
    model: installed,
    adjustment:
      effort === DEFAULT_CHAT_EFFORT
        ? null
        : { requested: DEFAULT_CHAT_EFFORT, applied: effort, reason: "model_first_use" },
  };
};

/** Explicit repair entry point for an unsupported remembered effort. */
export const resolveFirstUseSelection = (
  policy: StageModelPolicy,
  model: ChatModelId,
): ChatModelResolution => resolveChatModelSelection(policy, model, null);

/** Public catalog entry: installed metadata plus stage availability and honest eligibility. */
export const ChatCatalogEntry = Schema.Struct({
  ...ChatCatalogModel.fields,
  availability: Schema.Literals(["enabled", "not_enabled", "stage_unconfigured"]),
  accountEligibility: Schema.Literal("unverified"),
});
export type ChatCatalogEntry = typeof ChatCatalogEntry.Type;

export const ChatCatalog = Schema.Struct({
  version: Schema.Literal(1),
  stageConfigured: Schema.Boolean,
  defaultSelection: ChatSelection,
  // Only permitted, compatible gateway models are projected; no separate app allowlist.
  models: Schema.Array(ChatCatalogEntry),
});
export type ChatCatalog = typeof ChatCatalog.Type;

/** Serializes the complete catalog for the authenticated browser. Never reads credentials. */
export const publicChatCatalog = (policy: StageModelPolicy): ChatCatalog => ({
  version: 1,
  stageConfigured: gatewayCatalogSnapshot().available,
  defaultSelection: DEFAULT_CHAT_SELECTION,
  models: installedChatCatalog()
    .filter((model) => chatModelAvailability(policy, model.model) === "enabled")
    .map((model) => ({
      ...model,
      availability: chatModelAvailability(policy, model.model),
      accountEligibility: "unverified",
    })),
});
