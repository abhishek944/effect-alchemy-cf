import { fileURLToPath, URL } from "node:url";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Stack } from "alchemy/Stack";
import { Config, Effect } from "effect";

export const workerOptions = Effect.gen(function* () {
  if (globalThis.__ALCHEMY_RUNTIME__) return {};
  const stack = yield* Stack;
  const { dev: local } = yield* AlchemyContext;
  const production = stack.stage === "prod";
  const allowProduction = yield* Config.Boolean("ALLOW_PRODUCTION").pipe(Config.withDefault(false));
  if (local && !stack.stage.startsWith("dev_") && !stack.stage.startsWith("dev-")) {
    throw new Error(
      "Local development requires a dev_ or dev- stage, never the cloud dev/prod stages.",
    );
  }
  if (production && !allowProduction) {
    throw new Error("Production requires ALLOW_PRODUCTION=true and --stage prod.");
  }
  const allowlist = yield* Config.String("DEV_ACCESS_EMAILS").pipe(Config.withDefault(""));
  const emails = allowlist
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean);
  if (!local && !production && emails.length === 0) {
    throw new Error("Cloud development requires DEV_ACCESS_EMAILS for Cloudflare Access.");
  }
  const revision = yield* Config.String("GITHUB_SHA").pipe(Config.withDefault("unversioned"));
  const release = /^[a-f0-9]{40}$/.test(revision) ? revision : "unversioned";
  return {
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true, headSamplingRate: 1, persist: true },
      traces: { enabled: true, headSamplingRate: 1, persist: true },
    },
    main: fileURLToPath(new URL("./worker.ts", import.meta.url)),
    compatibility: { date: "2026-10-05", flags: ["nodejs_compat"] },
    assets: {
      directory: fileURLToPath(new URL("../../web/dist", import.meta.url)),
      notFoundHandling: "single-page-application" as const,
      runWorkerFirst: !local && !production ? true : ["/api/*"],
    },
    dev: { port: 1337 },
    env: {
      REQUIRE_ACCESS: !local && !production,
      OBS_SERVICE: stack.name,
      OBS_STAGE: stack.stage,
      OBS_RELEASE: release,
    },
    ...(!local && !production
      ? {
          access: {
            policies: [{ decision: "allow" as const, include: emails.map((email) => ({ email })) }],
          },
        }
      : {}),
  };
});
