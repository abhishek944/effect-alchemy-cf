import { createLangfuseTracing } from "@abhishek944/pi-langfuse";
import { telemetryOptions } from "@highchat/config/telemetry";

/** One lazy private exporter for independent Pi-AI titles, never native host inference. */
export const titleTracing = createLangfuseTracing(telemetryOptions(process.env));
