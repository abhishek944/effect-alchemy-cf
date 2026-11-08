import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import type { AppStage } from "./defaults.ts";
import { readAppConfig } from "./public.ts";

export function appStage(value: string | undefined): AppStage {
  const stage = value ?? "dev";
  if (stage !== "dev" && stage !== "prod") throw new Error("APP_STAGE must be dev or prod.");
  return stage;
}

/** One stage-to-file mapping owns loading, Turbo hashing, and documentation. */
const stageFiles = {
  dev: ".env.local",
  prod: ".env.prod",
} as const satisfies Record<AppStage, string>;

export function stageEnvFile(stage: AppStage): URL {
  return new URL(stageFiles[stage], import.meta.url);
}

/** Node-only: never export stage files or this loader into browser code. */
export function loadStage(stage: AppStage): Record<string, string | undefined> {
  return parseEnv(readFileSync(stageEnvFile(stage), "utf8"));
}

/** Node dotenv does not decode JSON-style escaped quotes. Verify writes before touching a file. */
export function serializeEnv(values: Readonly<Record<string, string | undefined>>): string {
  return (
    Object.entries(values)
      .map(([key, value]) => {
        if (value === undefined) throw new Error("Stage configuration values must be strings.");
        const quote = ["'", '"', "`"].find((candidate) => !value.includes(candidate));
        const encoded = quote === undefined ? value : `${quote}${value}${quote}`;
        const line = `${key}=${encoded}`;
        if (parseEnv(line)[key] !== value)
          throw new Error("Stage configuration value cannot be represented by dotenv syntax.");
        return line;
      })
      .join("\n") + "\n"
  );
}

/** Resolve public inputs before Turbo calculates task hashes. Stage files win over shell values. */
export function buildEnvironment(stage: AppStage, inherited: NodeJS.ProcessEnv = process.env) {
  const config = readAppConfig(loadStage(stage));
  const publicConfig = stagePublicConfig(stage, inherited);
  return {
    ...inherited,
    APP_STAGE: stage,
    APP_NAME: config.name,
    APP_DOMAIN: config.domain,
    CLERK_PUBLISHABLE_KEY: publicConfig.clerkPublishableKey,
  };
}

export type StagePublicConfig = {
  readonly name: string;
  readonly domain: string;
  /** Public by design; Clerk publishable keys are safe in the browser bundle. */
  readonly clerkPublishableKey: string;
};

/**
 * Public values a browser build may embed. The stage file is the source of
 * truth; a blank file entry falls back to the shell. Secrets are never read
 * here, so a server key can never reach the bundle.
 */
export function stagePublicConfig(
  stage: AppStage = appStage(process.env.APP_STAGE),
  inherited: NodeJS.ProcessEnv = process.env,
): StagePublicConfig {
  const values = loadStage(stage);
  const config = readAppConfig({
    APP_NAME: values.APP_NAME || inherited.APP_NAME,
    APP_DOMAIN: values.APP_DOMAIN || inherited.APP_DOMAIN || "",
  });
  const key = (values.CLERK_PUBLISHABLE_KEY || inherited.CLERK_PUBLISHABLE_KEY || "").trim();
  return {
    name: config.name,
    domain: config.domain,
    // Only a publishable key is accepted; a secret key value is refused outright.
    clerkPublishableKey: key.startsWith("pk_") ? key : "",
  };
}

/** Vite also supports direct workspace commands; defaults to the dev stage, not its NODE_ENV. */
export function buildAppConfig() {
  const stage = appStage(process.env.APP_STAGE);
  const values = loadStage(stage);
  return readAppConfig({
    APP_NAME: process.env.APP_NAME ?? values.APP_NAME,
    APP_DOMAIN: process.env.APP_DOMAIN ?? values.APP_DOMAIN,
  });
}
