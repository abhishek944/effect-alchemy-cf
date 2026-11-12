import { Option, Schema } from "effect";
import { installedChatModel } from "./chat-capability-catalog.ts";
import { ChatModelId, readField } from "./chat-capabilities.ts";
import { gatewayConfig } from "./chat-gateway-config.ts";

const ModelEntry = Schema.Struct({
  model_name: ChatModelId,
  litellm_params: Schema.Struct({ model: Schema.String }),
  model_info: Schema.Struct({
    mode: Schema.Literal("chat"),
    supports_function_calling: Schema.Literal(true),
  }),
});
const ImageEntry = Schema.Struct({
  model_name: Schema.String,
  litellm_params: Schema.Struct({ model: Schema.String }),
  model_info: Schema.Struct({ mode: Schema.Literal("image_generation") }),
});
const ModelInfo = Schema.Struct({ data: Schema.Array(Schema.Unknown) });
const PermittedModels = Schema.Struct({ data: Schema.Array(Schema.Struct({ id: Schema.String })) });
const snapshot: {
  available: boolean;
  ids: readonly string[];
  imageIds: readonly string[];
  permittedIds: readonly string[];
} = {
  available: false,
  ids: [],
  imageIds: [],
  permittedIds: [],
};
export const gatewayCatalogSnapshot = () => snapshot;

/** Read-only discovery using the inference credential. Raw gateway config never leaves this adapter. */
export const refreshGatewayCatalog = async (
  env: Readonly<Record<string, unknown>>,
): Promise<void> => {
  const config = gatewayConfig(env);
  let verified = false;
  try {
    if (config === null) return;
    const headers = { authorization: `Bearer ${config.inferenceKey}` };
    const response = await fetch(new URL("/model/info", config.baseUrl), {
      headers,
      redirect: "error",
    });
    if (!response.ok) {
      await response.body?.cancel();
      return;
    }
    const raw: unknown = await response.json();
    const info = Option.getOrNull(Schema.decodeUnknownOption(ModelInfo)(raw));
    if (info === null) return;
    const permittedResponse = await fetch(new URL("/v1/models", config.baseUrl), {
      headers,
      redirect: "error",
    });
    if (!permittedResponse.ok) {
      await permittedResponse.body?.cancel();
      return;
    }
    const permittedRaw: unknown = await permittedResponse.json();
    const permitted = Schema.decodeUnknownSync(PermittedModels)(permittedRaw);
    const ids = new Set(permitted.data.map((entry) => entry.id));
    // Exact canonical mappings only: no routers, wildcard aliases or inferred substitutions.
    const grouped = new Map<string, unknown[]>();
    for (const rawEntry of info.data) {
      const name = Option.getOrNull(
        Schema.decodeUnknownOption(ChatModelId)(readField(rawEntry, "model_name")),
      );
      if (name !== null) grouped.set(name, [...(grouped.get(name) ?? []), rawEntry]);
    }
    snapshot.ids = [...grouped].flatMap(([name, entries]) => {
      const compatible = entries.every((rawEntry) => {
        const entry = Option.getOrNull(Schema.decodeUnknownOption(ModelEntry)(rawEntry));
        return entry !== null && entry.model_name === entry.litellm_params.model;
      });
      return ids.has(name) && compatible && installedChatModel(name) !== null ? [name] : [];
    });
    snapshot.imageIds = [...ids].filter((id) => {
      const entries = info.data.filter((entry) => readField(entry, "model_name") === id);
      return (
        entries.length > 0 &&
        entries.every((rawEntry) => {
          const entry = Option.getOrNull(Schema.decodeUnknownOption(ImageEntry)(rawEntry));
          return entry !== null && entry.model_name === entry.litellm_params.model;
        })
      );
    });
    snapshot.permittedIds = [...ids];
    snapshot.available = true;
    verified = true;
  } catch {
    // Availability fails closed; never retain a stale permitted list after a failed refresh.
  } finally {
    if (!verified) {
      snapshot.available = false;
      snapshot.ids = [];
      snapshot.imageIds = [];
      snapshot.permittedIds = [];
    }
  }
};
