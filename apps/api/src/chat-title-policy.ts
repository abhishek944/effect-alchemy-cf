import { getSupportedThinkingLevels, type Model, type ThinkingLevel } from "@earendil-works/pi-ai";
import { Predicate } from "effect";

export const TITLE_MAX_TOKENS = 64;

export const titleReasoning = (model: Model<string>): ThinkingLevel | undefined => {
  const levels = getSupportedThinkingLevels(model);
  if (levels.includes("off")) return undefined;
  const first = levels[0];
  return first !== undefined && first !== "off" ? first : undefined;
};

/** Inspect the real provider-specific wire request before any network dispatch. */
export const guardTitlePayload = (
  payload: unknown,
  model: Model<string>,
  reasoning: ThinkingLevel | undefined,
): void => {
  if (!Predicate.isObject(payload)) throw new Error("Unexpected title payload");
  if (payload.tools !== undefined) throw new Error("Title request must not declare tools");
  if (model.api === "openai-responses") {
    if (payload.max_output_tokens !== TITLE_MAX_TOKENS) throw new Error("Title output cap missing");
    const effort = model.reasoning
      ? reasoning === undefined
        ? (model.thinkingLevelMap?.off ?? null)
        : (model.thinkingLevelMap?.[reasoning] ?? reasoning)
      : null;
    if (effort === null) {
      if (payload.reasoning !== undefined) throw new Error("Unexpected title reasoning");
    } else if (!Predicate.isObject(payload.reasoning) || payload.reasoning.effort !== effort) {
      throw new Error("Title reasoning mismatch");
    }
    return;
  }
  if (model.api !== "anthropic-messages") throw new Error("Unsupported title provider");
  const thinking = payload.thinking;
  if (reasoning === undefined) {
    if (
      payload.max_tokens !== TITLE_MAX_TOKENS ||
      (thinking !== undefined && (!Predicate.isObject(thinking) || thinking.type !== "disabled"))
    )
      throw new Error("Title thinking must be disabled");
    return;
  }
  if (!Predicate.isObject(thinking)) throw new Error("Title thinking missing");
  if (thinking.type === "adaptive") {
    const expected =
      model.thinkingLevelMap?.[reasoning] ?? (reasoning === "minimal" ? "low" : reasoning);
    if (
      payload.max_tokens !== TITLE_MAX_TOKENS ||
      !Predicate.isObject(payload.output_config) ||
      payload.output_config.effort !== expected
    )
      throw new Error("Title adaptive effort mismatch");
    return;
  }
  if (
    thinking.type !== "enabled" ||
    thinking.budget_tokens !== 1024 ||
    typeof payload.max_tokens !== "number" ||
    payload.max_tokens > 1024 + TITLE_MAX_TOKENS ||
    payload.max_tokens <= 1024
  )
    throw new Error("Title thinking budget exceeded");
};
