export type AppStage = "dev" | "prod";

/**
 * The stage configuration keys, shared by every Doppler stage. Provider
 * credentials are supplied at run time and are never part of this set.
 */
export const stageDefaults = (stage: AppStage) => ({
  APP_NAME: "highchat",
  APP_DOMAIN: stage === "prod" ? "highchat.space" : "",
  AUTH_BASE_URL: "",
  CHAT_HOST_URL: "",
  CLERK_PUBLISHABLE_KEY: "",
});
