import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
const record = (value) => typeof value === "object" && value !== null && !Array.isArray(value);

/** Development-family stages alone may consume a development audio key. @param {string} stage */
const isDevStage = (stage) => stage === "dev" || /^dev[-_][a-z0-9][a-z0-9._-]*$/.test(stage);

/**
 * Dedicated development-only OpenRouter audio profile. Called by user-owned
 * launch/plan, never builds/checks; inherited deployment credentials cannot
 * become audio credentials, and production loads no key at all.
 * @param {string} profile
 * @param {string} stage
 */
export function speechProfileEnvironment(profile, stage) {
  if (!isDevStage(stage)) return { OPENROUTER_API_KEY: "" };
  /** @type {unknown} */
  let document;
  /** @type {number | undefined} */
  let descriptor;
  try {
    const file = join(
      process.env.ALCHEMY_HOME ?? join(homedir(), ".alchemy"),
      "profiles",
      profile,
      "openrouter.json",
    );
    descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(descriptor);
    if (
      !stat.isFile() ||
      stat.size > 65536 ||
      (stat.mode & 0o077) !== 0 ||
      (typeof process.getuid === "function" && stat.uid !== process.getuid())
    ) {
      throw new Error("Profile must be private and owned by the current user.");
    }
    document = JSON.parse(readFileSync(descriptor, "utf8"));
  } catch (error) {
    if (
      descriptor === undefined &&
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return { OPENROUTER_API_KEY: "" };
    // oxlint-disable-next-line preserve-caught-error -- Parse errors can contain API keys; expose only safe guidance.
    throw new Error(
      "A configured OpenRouter profile must be a dedicated user-owned, mode0600 regular " +
        "profile at profiles/<profile>/openrouter.json under ALCHEMY_HOME " +
        "(default ~/.alchemy; no symlinks). See docs/chat-voice.md.",
    );
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
  if (
    !record(document) ||
    document.format !== "alchemy.profile/v1" ||
    document.provider !== "OpenRouter" ||
    !record(document.values) ||
    !record(document.values.stages)
  ) {
    throw new Error("Invalid dedicated OpenRouter profile format.");
  }
  const value = document.values.stages[stage];
  if (value === undefined || (record(value) && (value.apiKey === undefined || value.apiKey === "")))
    return { OPENROUTER_API_KEY: "" };
  if (
    !record(value) ||
    typeof value.apiKey !== "string" ||
    value.apiKey.length < 20 ||
    value.apiKey.length > 512 ||
    /\s/.test(value.apiKey)
  ) {
    throw new Error(
      `OpenRouter profile requires a private ${stage} apiKey; production never uses one.`,
    );
  }
  return { OPENROUTER_API_KEY: value.apiKey };
}
