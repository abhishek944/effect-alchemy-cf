import { fileURLToPath, URL } from "node:url";
import type * as Bundle from "alchemy/Bundle";
import type { WorkerSourceDescriptor } from "../node_modules/alchemy/lib/Cloudflare/Workers/Worker.js";

/** Plain-data descriptor shared by dev and build serialization verification. */
export const chatWorkerSource = (): WorkerSourceDescriptor => ({
  provider: new URL("./chat-worker-source.ts", import.meta.url).href,
  devMode: "bundle",
  options: { main: fileURLToPath(new URL("./worker.ts", import.meta.url)) },
});

/** Absolute path of the Workers-only module that owns the native chat classes. */
export const chatObjectsModule = fileURLToPath(new URL("./chat-objects.ts", import.meta.url));

/** Re-export line appended to any generated entry so the native classes survive. */
export const chatObjectExports = `export { ChatCatalog, ChatConversation } from ${JSON.stringify(chatObjectsModule)};`;

type Plugins = NonNullable<NonNullable<Bundle.BundleConfig["input"]>["plugins"]>;
type RolldownPluginOption = Plugins extends readonly (infer Item)[] ? Item : Plugins;

/**
 * Alchemy's generated Effect entry imports only the default application entry,
 * so native Durable Object classes must be appended explicitly. Bindings and
 * migrations keep coming from the raw `host.bind` class names; this does not
 * register the classes as Effect Durable Objects or generate bridge proxies.
 */
export const chatObjectsEntryPlugin = (): RolldownPluginOption => ({
  name: "starter:chat-objects-entry",
  transform(code: string, id: string) {
    if (!id.includes("virtual:alchemy-entry:")) return null;
    return { code: `${code}\n${chatObjectExports}\n`, map: null };
  },
});
