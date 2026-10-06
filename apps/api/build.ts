import { rmSync } from "node:fs";
import cloudflare from "@alchemy.run/cloudflare-runtime/rolldown";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Bundle from "alchemy/Bundle";
import { Effect } from "effect";
import { serviceName } from "../../service.config.ts";

rmSync("./dist", { recursive: true, force: true });

await Effect.runPromise(
  Effect.gen(function* () {
    const virtualEntry = yield* Bundle.virtualEntryPlugin;
    yield* Bundle.build(
      {
        input: "./src/worker.ts",
        external: [
          "vite",
          "esbuild",
          "@vitejs/devtools/config",
          "@effect/platform-bun/BunHttpServer",
          "@effect/platform-bun/BunServices",
          "@effect/platform-bun/BunSocket",
          "@effect/platform-bun/BunRuntime",
        ],
        plugins: [
          cloudflare({
            compatibilityDate: "2026-10-05",
            compatibilityFlags: ["nodejs_compat"],
          }),
          virtualEntry(
            (path) => `
            import { WorkerEntrypoint } from "cloudflare:workers";
            import { makeWorkerBridge } from "alchemy/Cloudflare/Bridge";
            import entrypoint from ${JSON.stringify(path)};
            export default makeWorkerBridge(WorkerEntrypoint, {
              entrypoint,
              stack: { name: ${JSON.stringify(serviceName)}, stage: "build" },
            });
          `,
          ),
        ],
      },
      { dir: "./dist", format: "esm", minify: true, strictExecutionOrder: true },
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
