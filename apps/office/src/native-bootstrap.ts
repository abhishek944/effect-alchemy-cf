import { pathToFileURL } from "node:url";
import { Effect, Exit, Schema } from "effect";
import { observeBootstrap } from "./native-bootstrap-lifecycle.ts";

// Keep native/provider imports inside the observed entry boundary.
const load = () => import("./native-bootstrap-runtime.ts");
export const nativeBootstrap = Effect.gen(function* () {
  const runtime = yield* Effect.promise(load);
  return yield* runtime.nativeBootstrap;
});

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  await observeBootstrap(async (enter) => {
    enter("module");
    const runtime = await load();
    enter("bootstrap");
    const outcome = await Effect.runPromiseExit(Effect.scoped(runtime.nativeBootstrap));
    if (Exit.isFailure(outcome)) throw outcome.cause;
    const connection = outcome.value;
    enter("stopped-notification");
    await connection.json(
      "/bootstrap/stopped",
      {},
      Schema.Null,
      new AbortController().signal,
      Date.now() + 10_000,
    );
  });
}
