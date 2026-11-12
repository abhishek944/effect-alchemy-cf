import type { AppStage } from "./defaults.ts";
import { stageDefaults } from "./defaults.ts";
import { readAppConfig } from "./public.ts";

export function appStage(value: string | undefined): AppStage {
  const stage = value ?? "dev";
  if (stage !== "dev" && stage !== "prod") throw new Error("APP_STAGE must be dev or prod.");
  return stage;
}

/** The stage values Doppler injects; an absent value stays absent instead of becoming empty. */
export type StageValues = Readonly<
  Record<keyof ReturnType<typeof stageDefaults>, string | undefined>
>;

/**
 * Reads stage values from the process environment. `doppler run` injects them
 * with DOPPLER_CONFIG set; no stage env file is read or created. The literal is
 * checked against StageValues, so adding a default without reading it fails.
 */
export function loadStage(inherited: NodeJS.ProcessEnv = process.env): StageValues {
  return {
    APP_NAME: inherited.APP_NAME,
    APP_DOMAIN: inherited.APP_DOMAIN,
    AUTH_BASE_URL: inherited.AUTH_BASE_URL,
    CHAT_HOST_URL: inherited.CHAT_HOST_URL,
    CLERK_PUBLISHABLE_KEY: inherited.CLERK_PUBLISHABLE_KEY,
  } satisfies StageValues;
}

/**
 * A Doppler-injected process must define every shared key. Without injection the
 * checked-in defaults apply, which keeps CI lint and build credential-free.
 */
export function missingStageKeys(inherited: NodeJS.ProcessEnv = process.env): string[] {
  if (inherited.DOPPLER_CONFIG === undefined) return [];
  return Object.entries(loadStage(inherited))
    .filter(([, value]) => value === undefined)
    .map(([key]) => key);
}

export type StagePublicConfig = {
  readonly name: string;
  readonly domain: string;
  /** Public by design; Clerk publishable keys are safe in the browser bundle. */
  readonly clerkPublishableKey: string;
};

/**
 * Public values a browser build may embed. The process environment is the
 * source of truth; blanks fall back to the stage defaults. Secrets are never
 * read here, so a server key can never reach the bundle.
 */
export function stagePublicConfig(
  stage: AppStage = appStage(process.env.APP_STAGE),
  inherited: NodeJS.ProcessEnv = process.env,
): StagePublicConfig {
  const defaults = stageDefaults(stage);
  const values = loadStage(inherited);
  const config = readAppConfig({
    APP_NAME: values.APP_NAME || defaults.APP_NAME,
    APP_DOMAIN: values.APP_DOMAIN || defaults.APP_DOMAIN,
  });
  const key = (values.CLERK_PUBLISHABLE_KEY ?? "").trim();
  return {
    name: config.name,
    domain: config.domain,
    // Only a publishable key is accepted; a secret key value is refused outright.
    clerkPublishableKey: key.startsWith("pk_") ? key : "",
  };
}

/** Resolve public inputs before Turbo calculates task hashes. */
export function buildEnvironment(stage: AppStage, inherited: NodeJS.ProcessEnv = process.env) {
  const missing = missingStageKeys(inherited);
  if (missing.length > 0)
    throw new Error(`Doppler stage config is missing keys: ${missing.join(", ")}.`);
  const config = stagePublicConfig(stage, inherited);
  return {
    ...inherited,
    APP_STAGE: stage,
    APP_NAME: config.name,
    APP_DOMAIN: config.domain,
    CLERK_PUBLISHABLE_KEY: config.clerkPublishableKey,
  };
}

/** Vite also supports direct workspace commands; defaults to the dev stage, not its NODE_ENV. */
export function buildAppConfig() {
  const stage = appStage(process.env.APP_STAGE);
  const defaults = stageDefaults(stage);
  return readAppConfig({
    APP_NAME: process.env.APP_NAME || defaults.APP_NAME,
    APP_DOMAIN: process.env.APP_DOMAIN || defaults.APP_DOMAIN,
  });
}
