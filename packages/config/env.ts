import { stageDefaults } from "./defaults.ts";
import { authBaseURL, readAppConfig } from "./public.ts";
import { appStage, loadStage, missingStageKeys } from "./stage.ts";

const stage = appStage(process.env.APP_STAGE);
const defaults = stageDefaults(stage);
const values = loadStage();
const config = readAppConfig({
  APP_NAME: values.APP_NAME || defaults.APP_NAME,
  APP_DOMAIN: values.APP_DOMAIN || defaults.APP_DOMAIN,
});
authBaseURL(config, values.AUTH_BASE_URL ?? "");

const host = values.CHAT_HOST_URL ?? "";
if (host) {
  let origin: URL;
  try {
    origin = new URL(host);
  } catch {
    throw new Error("CHAT_HOST_URL must be a private HTTPS origin, or blank.");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== "/"
  )
    throw new Error("CHAT_HOST_URL must be a private HTTPS origin, or blank.");
}

const key = (values.CLERK_PUBLISHABLE_KEY ?? "").trim();
if (key && !key.startsWith("pk_"))
  throw new Error("CLERK_PUBLISHABLE_KEY must be a pk_ publishable key, never a secret key.");

const missing = missingStageKeys();
if (missing.length > 0)
  throw new Error(`Doppler stage config is missing keys: ${missing.join(", ")}.`);

process.stdout.write(
  `Stage configuration is valid for ${stage} (${process.env.DOPPLER_CONFIG === undefined ? "defaults" : "Doppler-injected"}).\n`,
);
