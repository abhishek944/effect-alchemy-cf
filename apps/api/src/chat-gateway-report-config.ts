import { Option, Schema } from "effect";
import { UsageDate } from "@highchat/chat-contract/gateway-usage";

const FilterKey = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]+$/));
const KeyWindow = Schema.Struct({
  apiKey: FilterKey,
  start: UsageDate,
  end: Schema.NullOr(UsageDate),
});
const ReportSettings = Schema.Struct({
  credential: Schema.String.check(Schema.isMinLength(1)),
  activation: UsageDate,
  currentKey: FilterKey,
  windows: Schema.Array(KeyWindow).check(Schema.isMinLength(1)),
});
export const reportSettings = (env: Readonly<Record<string, unknown>>) => {
  try {
    const raw: unknown =
      typeof env.LITELLM_REPORT_KEY_WINDOWS === "string"
        ? JSON.parse(env.LITELLM_REPORT_KEY_WINDOWS)
        : undefined;
    const config = Option.getOrNull(
      Schema.decodeUnknownOption(ReportSettings)({
        credential: env.LITELLM_REPORT_KEY,
        activation: env.LITELLM_USAGE_ACTIVATED_ON,
        currentKey: env.LITELLM_INFERENCE_KEY_ID,
        windows: raw,
      }),
    );
    if (
      config === null ||
      !config.credential.trim() ||
      config.credential === env.LITELLM_INFERENCE_KEY ||
      !config.windows.some((w) => w.apiKey === config.currentKey && w.end === null)
    )
      return null;
    for (const [index, window] of config.windows.entries()) {
      if (window.start < config.activation || (window.end !== null && window.end < window.start))
        return null;
      if (
        config.windows.some(
          (other, i) =>
            i !== index &&
            other.apiKey === window.apiKey &&
            window.start <= (other.end ?? "9999-12-31") &&
            other.start <= (window.end ?? "9999-12-31"),
        )
      )
        return null;
    }
    return config;
  } catch {
    return null;
  }
};
