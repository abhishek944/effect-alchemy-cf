import { Schema } from "effect";

export const AppName = Schema.String.check(
  Schema.isTrimmed(),
  Schema.isMinLength(1),
  Schema.isMaxLength(80),
  Schema.isPattern(/^[^\p{Cc}]+$/u),
);
const Hostname = Schema.String.check(
  Schema.isMaxLength(253),
  Schema.isPattern(
    /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u,
  ),
);
export const PublicAppConfig = Schema.Struct({ name: AppName });
export type PublicAppConfig = typeof PublicAppConfig.Type;
export const AppConfig = Schema.Struct({
  name: AppName,
  domain: Schema.Union([Schema.Literal(""), Hostname]),
});
export type AppConfig = typeof AppConfig.Type;

/** Only explicitly selected, nonsecret fields cross this boundary. */
export function readAppConfig(values: Readonly<Record<string, unknown>>): AppConfig {
  try {
    return Schema.decodeUnknownSync(AppConfig)({
      name: values.APP_NAME,
      domain: values.APP_DOMAIN ?? "",
    });
  } catch {
    throw new Error(
      "APP_NAME must be printable and nonblank; APP_DOMAIN must be a lowercase hostname or blank.",
    );
  }
}

/** A domain chooses the cloud origin; local callers deliberately do not use it. */
export function authBaseURL(config: AppConfig, override = ""): string {
  const explicit = override.trim();
  const derived = config.domain ? `https://${config.domain}` : "";
  if (explicit) {
    const url = URL.canParse(explicit) ? new URL(explicit) : undefined;
    if (url?.protocol !== "https:" || url.origin !== explicit)
      throw new Error("AUTH_BASE_URL must be an HTTPS origin without a path or credentials.");
    if (derived && explicit !== derived)
      throw new Error("AUTH_BASE_URL must match the configured APP_DOMAIN.");
  }
  return explicit || derived;
}
