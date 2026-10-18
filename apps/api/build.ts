import { rmSync } from "node:fs";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Artifacts from "alchemy/Artifacts";
import { Effect } from "effect";
import { resolveSource } from "./node_modules/alchemy/lib/Cloudflare/Workers/Source.js";
import type { WorkerSourceDescriptor } from "./node_modules/alchemy/lib/Cloudflare/Workers/Worker.js";
import type { WorkerBuildOptions } from "./node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";
import {
  wrapRpcHandlers,
  unwrapRpcHandlers,
} from "./node_modules/alchemy/lib/Local/RpcSerialization.js";
import { serviceName } from "../../service.config.ts";
import { chatWorkerSource } from "./src/chat-objects-entry.ts";

rmSync("./dist", { recursive: true, force: true });

const rpc = unwrapRpcHandlers(
  wrapRpcHandlers({ echo: (value: WorkerSourceDescriptor) => Effect.succeed(value) }),
);
const exported = new Set<string>();
const build: WorkerBuildOptions = {
  input: {
    plugins: [
      {
        name: "starter:verify-native-entry",
        generateBundle(_options, bundle) {
          for (const chunk of Object.values(bundle)) {
            if (chunk.type === "chunk" && chunk.isEntry) {
              for (const name of chunk.exports) exported.add(name);
            }
          }
        },
      },
    ],
  },
  output: { dir: "./dist" },
};

await Effect.runPromise(
  Effect.gen(function* () {
    const original = chatWorkerSource();
    const descriptor = yield* rpc.echo(original);
    if (JSON.stringify(descriptor) !== JSON.stringify(original)) {
      throw new Error("Native Worker source changed across dev RPC serialization");
    }
    const source = yield* resolveSource({ source: descriptor });
    yield* source.build({
      id: "Api",
      fqn: "Api",
      workerName: "Api",
      compatibility: { date: "2026-10-05", flags: [] },
      entry: { kind: "effect", exports: {} },
      stack: { name: serviceName, stage: "build" },
      extraOptions: build,
      env: undefined,
      assets: undefined,
    });
    for (const name of ["ChatCatalog", "ChatConversation", "default"]) {
      if (!exported.has(name)) throw new Error(`RPC-fed Worker entry lacks ${name}`);
    }
    console.log("RPC-fed Worker source exports ChatCatalog, ChatConversation and default.");
  }).pipe(
    Effect.provideService(AlchemyContext, {
      dotAlchemy: "./dist/.alchemy",
      dev: true,
      updateStateStore: false,
      adopt: false,
    }),
    Effect.provideService(Artifacts.Artifacts, Artifacts.makeScopedArtifacts(new Map(), "Api")),
    Effect.provide(NodeServices.layer),
    Effect.scoped,
  ),
);
