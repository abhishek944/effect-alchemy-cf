import ApiWorker from "@starter/api/worker";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Config, Effect, Layer } from "effect";
import { serviceName } from "../../service.config.ts";

export default Alchemy.Stack(
  serviceName,
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Effect.gen(function* () {
        const { dev } = yield* AlchemyContext;
        const inherited = yield* Config.Boolean("ALCHEMY_DEV").pipe(
          Config.withDefault(false),
          Effect.orDie,
        );
        if (dev !== inherited) throw new Error("ALCHEMY_DEV must match the CLI development mode.");
        return dev ? Alchemy.localState() : Cloudflare.state();
      }),
    ),
  },
  Effect.gen(function* () {
    const api = yield* ApiWorker;
    return { url: api.url };
  }),
);
