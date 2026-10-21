import { fileURLToPath, URL } from "node:url";
import * as Cloudflare from "alchemy/Cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Stack } from "alchemy/Stack";
import { Config, Effect, Redacted } from "effect";
import { serviceName } from "../../../service.config.ts";
import { chatWorkerSource } from "./chat-objects-entry.ts";
import { ChatFilesBucket } from "./chat-resources.ts";
import { OfficeStorage } from "./office-resources.ts";

export const workerOptions = Effect.gen(function* () {
  if (globalThis.__ALCHEMY_RUNTIME__) return {};
  const stack = yield* Stack;
  const chatFiles = yield* ChatFilesBucket;
  const office = yield* OfficeStorage;
  const modelAllowlist = yield* Config.String("CHAT_MODEL_ALLOWLIST").pipe(Config.withDefault(""));
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
  const devIdps =
    !local && !production
      ? [
          (yield* Cloudflare.Access.IdentityProvider("DevEmailPin", {
            type: "onetimepin",
          })).identityProviderId.as<string>(),
        ]
      : undefined;
  const revision = yield* Config.String("GITHUB_SHA").pipe(Config.withDefault("unversioned"));
  const release = /^[a-f0-9]{40}$/.test(revision) ? revision : "unversioned";
  // Stage isolation: local may only use the managed dev gateway when it is
  // explicitly configured, cloud dev derives that id, prod needs its own id.
  const expectedDevGateway = `${serviceName.toLowerCase()}-dev-chat`;
  const requestedGateway = yield* Config.String("CHAT_GATEWAY_ID").pipe(Config.withDefault(""));
  if (
    !local &&
    !production &&
    requestedGateway.length > 0 &&
    requestedGateway !== expectedDevGateway
  ) {
    throw new Error(
      `Cloud development must use the managed dev chat gateway ${expectedDevGateway}.`,
    );
  }
  const chatGatewayId = local
    ? requestedGateway === expectedDevGateway
      ? expectedDevGateway
      : ""
    : production
      ? requestedGateway.length > 0 && requestedGateway !== expectedDevGateway
        ? requestedGateway
        : ""
      : expectedDevGateway;
  return {
    observability: {
      enabled: true,
      redactQueryString: true,
      logs: { enabled: true, invocationLogs: true, headSamplingRate: 1, persist: true },
      traces: { enabled: true, headSamplingRate: 1, persist: true },
    },
    // Only data crosses dev RPC; the provider creates native export hooks.
    source: chatWorkerSource(),
    compatibility: {
      date: local ? "2026-09-25" : "2026-10-05",
      // nodejs_compat is default from 2026-08-04; workerd rejects the
      // redundant runtime flag, while Alchemy tooling still materializes
      // Node support from the compatibility date.
      ...((local ? "2026-09-25" : "2026-10-05") >= "2026-08-04"
        ? { flags: [] }
        : { flags: ["nodejs_compat"] }),
    },
    assets: {
      directory: fileURLToPath(new URL("../../web/dist", import.meta.url)),
      notFoundHandling: "single-page-application" as const,
      runWorkerFirst: !local && !production ? true : ["/api/*", "/universer-api/*"],
    },
    dev: { host: "localhost", port: 1337, strictPort: true },
    env: {
      // Non-JSON boolean literals survive Alchemy runtime env unpacking as strings.
      REQUIRE_ACCESS: !local && !production ? "yes" : "no",
      AUTH_LOCAL: local ? "yes" : "no",
      OBS_SERVICE: stack.name,
      OBS_STAGE: stack.stage,
      OBS_RELEASE: release,
      CHAT_GATEWAY_ID: chatGatewayId,
      CHAT_MODEL_ALLOWLIST: modelAllowlist,
      CHAT_FILES: chatFiles,
      OFFICE_D1: office.database,
      OFFICE_R2: office.bucket,
      // Operator-supplied immutable application image (host + fixed job entries).
      OFFICE_IMAGE_REF: Config.String("OFFICE_IMAGE_REF"),
      // Speech is nonproduction-only; production binds no audio credential.
      ...(!production
        ? {
            OPENROUTER_API_KEY: Config.Redacted("OPENROUTER_API_KEY").pipe(
              Config.withDefault(Redacted.make("")),
            ),
          }
        : {}),
      BILLING_ENVIRONMENT: production ? "live" : "test",
      BILLING_NAMESPACE: `${stack.name}:${stack.stage}`,
      // Custom sources suppress the local automatic ASSETS hook.
      ...(local ? { ASSETS: { kind: "Cloudflare.Workers.Assets" as const } } : {}),
      // No remote AI binding without an explicitly configured gateway id.
      ...(chatGatewayId.length > 0 ? { AI: Cloudflare.Workers.AI() } : {}),
    },
    ...(!local && !production
      ? {
          access: {
            allowedIdps: devIdps,
            autoRedirectToIdentity: true,
            policies: [{ decision: "allow" as const, include: emails.map((email) => ({ email })) }],
          },
        }
      : {}),
  };
});
