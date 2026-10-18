import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Read only the selected private profile; never print its contents.
 * @param {string} profile
 * @param {string} stage
 * @param {Record<string, string | undefined>} configuration
 */
export function billingProfileEnvironment(profile, stage, configuration) {
  /** @type {Record<string, string>} */
  const result = {
    DODO_API_KEY: "",
    DODO_WEBHOOK_SECRET: "",
    POLAR_API_KEY: "",
    POLAR_WEBHOOK_SECRET: "",
    BILLING_PROFILE_JSON: "",
  };
  const enabled = ["dodo", "polar"].filter(
    (provider) => configuration[`${provider.toUpperCase()}_ACCOUNT_ID`],
  );
  if (enabled.length === 0) return result;
  /** @type {unknown} */
  let document;
  try {
    const fromCI =
      stage === "prod" &&
      process.env.CI === "true" &&
      process.env.GITHUB_EVENT_NAME === "push" &&
      process.env.GITHUB_REF === "refs/heads/prod";
    const source = fromCI
      ? process.env.BILLING_PROFILE_JSON
      : readFileSync(
          join(
            process.env.ALCHEMY_HOME ?? join(homedir(), ".alchemy"),
            "profiles",
            profile,
            "billing.json",
          ),
          "utf8",
        );
    document = JSON.parse(source ?? "");
  } catch {
    throw new Error("Configured billing requires the matching private Billing profile.");
  }
  if (
    !isRecord(document) ||
    document.format !== "alchemy.profile/v1" ||
    document.provider !== "Billing" ||
    !isRecord(document.values)
  ) {
    throw new Error("Invalid private Billing profile format.");
  }
  for (const provider of enabled) {
    const prefix = provider.toUpperCase();
    const value = document.values[provider];
    if (
      !isRecord(value) ||
      value.mode !== (stage === "prod" ? "live" : "test") ||
      value.accountId !== configuration[`${prefix}_ACCOUNT_ID`] ||
      typeof value.apiKey !== "string" ||
      !value.apiKey.trim() ||
      typeof value.webhookSecret !== "string" ||
      !value.webhookSecret.trim()
    ) {
      throw new Error(
        "Billing profile account, mode and credentials must match the selected stage.",
      );
    }
    result[`${prefix}_API_KEY`] = value.apiKey;
    result[`${prefix}_WEBHOOK_SECRET`] = value.webhookSecret;
  }
  return result;
}
