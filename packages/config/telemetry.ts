/** Explicit server-only metadata capture. No ambient capture/destination fallback. */
export const telemetryOptions = (env: Readonly<Record<string, unknown>>) => {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  const baseUrl = env.LANGFUSE_BASE_URL;
  const environment = env.APP_STAGE ?? "dev";
  if (
    env.LANGFUSE_ENABLED !== "true" ||
    typeof publicKey !== "string" ||
    typeof secretKey !== "string" ||
    !publicKey.trim() ||
    !secretKey.trim() ||
    typeof baseUrl !== "string" ||
    !baseUrl.trim() ||
    (environment !== "dev" && environment !== "prod")
  )
    return { enabled: false };
  try {
    const url = new URL(baseUrl);
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== "https:" && !(local && url.protocol === "http:"))
    )
      return { enabled: false };
  } catch {
    return { enabled: false };
  }
  return {
    config: {
      publicKey,
      secretKey,
      baseUrl,
      environment,
      release: "",
      capture: "metadata" as const,
    },
  };
};
