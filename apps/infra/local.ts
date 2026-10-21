import * as Alchemist from "alchemy/Alchemist";
import { runMain } from "alchemy/Util/PlatformServices";
import { Effect } from "effect";
import { fileURLToPath, URL } from "node:url";
import type * as StackModule from "./alchemy.run.ts";

// Unlike the CLI's dev command, this runner never watches or reloads the stack.
runMain(
  Effect.gen(function* () {
    // Alchemist exposes unknown planning failures; normalize them to Error below.
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off
    const plan = yield* Alchemist.Stack.plan<typeof StackModule>({
      target: {
        entrypoint: fileURLToPath(new URL("./alchemy.run.ts", import.meta.url)),
        stage: "dev_local",
        profile: "default",
      },
      operation: "deploy",
      dev: true,
    }).pipe(Effect.mapError((cause) => new Error("Local stack planning failed", { cause })));
    const output = yield* Alchemist.Stack.apply(plan);
    yield* Effect.log(`Local service: ${output.url} (no watching; restart to rebuild)`);
    // Keep local providers alive until shutdown; their scope owns workerd.
    return yield* Effect.never;
  }).pipe(Effect.provide(Alchemist.layer()), Effect.scoped),
);
