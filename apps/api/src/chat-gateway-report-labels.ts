import { CATALOG_MODELS } from "@abhishek944/pi-image-gen/core";
import { gatewayModelMetadata } from "./chat-gateway-models.ts";

/** Upstream aliases can contain operator/private data. Only pinned canonical identities leave the API. */
export const publicReportModel = (value: string): string => {
  const image = CATALOG_MODELS.find(
    (model) => model === value || model.slice("openai/".length) === value,
  );
  if (image !== undefined) return image;
  const exact = gatewayModelMetadata.find((model) => model.id === value);
  if (exact !== undefined) return exact.id;
  const matches = gatewayModelMetadata.filter(
    (model) => model.id.split("/").slice(1).join("/") === value,
  );
  return matches.length === 1 ? (matches[0]?.id ?? "Unknown") : "Unknown";
};
export const publicReportProvider = (value: string): string =>
  value === "openai" || value === "anthropic" ? value : "Unknown";
