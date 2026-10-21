import ApiWorker from "@starter/api/worker";
import { ChatFilesBucket } from "@starter/api/chat-resources";
import { OfficeStorage } from "@starter/api/office-resources";
import * as Alchemy from "alchemy";
import * as Cloudflare from "alchemy/Cloudflare";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Stack } from "alchemy/Stack";
import { Config, Effect, Layer } from "effect";
import { serviceName } from "../../service.config.ts";

const expectedDevGateway = `${serviceName.toLowerCase()}-dev-chat`;

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
    const { dev: local } = yield* AlchemyContext;
    const stack = yield* Stack;
    const production = stack.stage === "prod";
    const requested = yield* Config.String("CHAT_GATEWAY_ID").pipe(Config.withDefault(""));

    if (!local && !production) {
      // Cloud development owns one deterministic private-chat gateway.
      if (requested.length > 0 && requested !== expectedDevGateway) {
        throw new Error(
          `Cloud development must use the managed dev chat gateway ${expectedDevGateway}.`,
        );
      }
      yield* Cloudflare.AI.Gateway("ChatGateway", {
        id: expectedDevGateway,
        authentication: true,
        cacheTtl: null,
        collectLogs: false,
      });
    } else if (!local && production) {
      // Production never references the development gateway. Without an
      // explicit production id the chat API fails closed instead.
      if (requested.length > 0 && requested !== expectedDevGateway) {
        yield* Cloudflare.AI.Gateway("ChatGateway", {
          id: requested,
          cacheTtl: null,
          collectLogs: false,
        });
      }
    }

    const chatFiles = yield* Cloudflare.R2.Bucket("ChatFiles", {
      publicAccess: false,
      domains: [],
      cors: [],
      forceDestroy: false,
    });
    const officeDatabase = yield* Cloudflare.D1.Database("OfficeDatabase");
    const officeData = yield* Cloudflare.R2.Bucket("OfficeData", {
      publicAccess: false,
      domains: [],
      cors: [],
      lifecycleRules: [],
      forceDestroy: false,
    });
    const api = yield* ApiWorker.pipe(
      Effect.provideService(ChatFilesBucket, chatFiles),
      Effect.provideService(OfficeStorage, { database: officeDatabase, bucket: officeData }),
    );
    return { url: api.url };
  }),
);
