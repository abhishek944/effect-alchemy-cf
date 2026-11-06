import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import type { AppStage } from "./defaults.ts";
import { readAppConfig } from "./public.ts";

export function appStage(value: string | undefined): AppStage {
  const stage = value ?? "dev";
  if (stage !== "dev" && stage !== "prod") throw new Error("APP_STAGE must be dev or prod.");
  return stage;
}

/** Node-only: never export stage files or this loader into browser code. */
export function loadStage(stage: AppStage): Record<string, string | undefined> {
  return parseEnv(readFileSync(new URL(`.env.${stage}`, import.meta.url), "utf8"));
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
  return { ...inherited, APP_STAGE: stage, APP_NAME: config.name, APP_DOMAIN: config.domain };
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
