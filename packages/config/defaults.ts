export type AppStage = "dev" | "prod";

export const stageDefaults = (stage: AppStage) => ({
  APP_NAME: "highchat",
  APP_DOMAIN: stage === "prod" ? "highchat.space" : "",
  DEV_ACCESS_EMAILS: "",
  AUTH_BASE_URL: "",
  ALLOW_PRODUCTION: "false",
  CHAT_GATEWAY_ID: "",
  CHAT_MODEL_ALLOWLIST: "",
});
