/** Server-only OpenRouter speech configuration. Browser input never chooses a destination or key. */
export const SPEECH_API_KEY = "OPENROUTER_API_KEY";
export const TRANSCRIPTION_ENDPOINT = "https://openrouter.ai/api/v1/audio/transcriptions";
export const SYNTHESIS_ENDPOINT = "https://openrouter.ai/api/v1/audio/speech";

export type SpeechRuntime = {
  /** Server-only credential. Never logged, serialized or returned to a client. */
  readonly apiKey: string;
};

export type SpeechSetupFailure = "not_configured" | "invalid_config" | "stage_not_allowed";
export type SpeechRuntimeResolution =
  | { readonly ok: true; readonly runtime: SpeechRuntime }
  | { readonly ok: false; readonly code: SpeechSetupFailure };

/** Preserve development-only audio; production never consumes a development key. */
export const isDevStage = (stage: string): boolean =>
  stage === "dev" || /^dev[-_][a-z0-9][a-z0-9._-]*$/.test(stage);

export const resolveSpeechRuntime = (
  env: Readonly<Record<string, unknown>>,
  stage: string,
): SpeechRuntimeResolution => {
  if (!isDevStage(stage)) return { ok: false, code: "stage_not_allowed" };
  const key = env[SPEECH_API_KEY];
  if (typeof key !== "string" || key === "") return { ok: false, code: "not_configured" };
  if (key.length < 20 || key.length > 512 || /\s/.test(key))
    return { ok: false, code: "invalid_config" };
  return { ok: true, runtime: { apiKey: key } };
};

export const speechProviderHeaders = (runtime: SpeechRuntime, json: boolean): Headers => {
  const headers = new Headers({ authorization: `Bearer ${runtime.apiKey}` });
  if (json) headers.set("content-type", "application/json");
  return headers;
};
