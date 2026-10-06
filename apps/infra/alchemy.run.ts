import ApiWorker from "@starter/api/worker";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Effect, Layer } from "effect";
import { serviceName } from "../../service.config.ts";

export default Alchemy.Stack(
  serviceName,
  {
    providers: Cloudflare.providers(),
    state: Layer.unwrap(
      Effect.gen(function* () {
        const { dev } = yield* AlchemyContext;
        return dev ? Alchemy.localState() : Cloudflare.state();
      }),
    ),
  },
  Effect.gen(function* () {
    const api = yield* ApiWorker;
    return { url: api.url };
  }),
);
