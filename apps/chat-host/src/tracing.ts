import { createLangfuseTracing } from "@abhishek944/pi-langfuse";
import { telemetryOptions } from "@highchat/config/telemetry";

/** One lazy private exporter across all app-owned SDK sessions in this process. */
export const tracing = createLangfuseTracing(telemetryOptions(process.env));
