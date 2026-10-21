import * as Artifacts from "alchemy/Artifacts";
import { Effect, Schema, Stream } from "effect";
import {
  SourceProviderError,
  type SourceContext,
  type WorkerSourceModule,
} from "../node_modules/alchemy/lib/Cloudflare/Workers/Source.js";
import {
  makeRolldownSource,
  type WorkerBuildOptions,
} from "../node_modules/alchemy/lib/Cloudflare/Workers/Sources/Rolldown.js";
import { chatObjectsEntryPlugin } from "./chat-objects-entry.ts";
import { optionalPeerBuildPlugin } from "./optional-peer-build.ts";
import { profileWebpPlugin } from "./profile-webp-build.ts";

const Options = Schema.Struct({ main: Schema.String });

/** Instantiate hooks provider-side: functions cannot cross Alchemy's dev RPC. */
const withNativeExports = <T extends SourceContext>(ctx: T): T => {
  const options: WorkerBuildOptions = ctx.extraOptions ?? {};
  return {
    ...ctx,
    extraOptions: {
      ...options,
      input: {
        ...options.input,
        plugins: [
          options.input?.plugins,
          chatObjectsEntryPlugin(),
          profileWebpPlugin(),
          optionalPeerBuildPlugin(),
        ],
      },
    },
  };
};

// Pinned Alchemy internals: its public Cloudflare wildcard lacks these modules.
export default {
  make: (options) =>
    Schema.decodeUnknownEffect(Options)(options).pipe(
      Effect.mapError(
        (cause) =>
          new SourceProviderError({
            provider: import.meta.url,
            message: "Invalid native chat Worker source options.",
            cause,
          }),
      ),
      Effect.map((parsed) => {
        const source = makeRolldownSource(parsed);
        return {
          ...source,
          build: (ctx) => source.build(withNativeExports(ctx)),
          hash: (ctx, previous) => source.hash(withNativeExports(ctx), previous),
          dev: (ctx) =>
            Effect.gen(function* () {
              // Build once. No watcher or polling; restarting loads source changes.
              const { bundle } = yield* source
                .build(withNativeExports(ctx))
                .pipe(
                  Effect.provideService(
                    Artifacts.Artifacts,
                    Artifacts.makeScopedArtifacts(new Map(), ctx.fqn),
                  ),
                );
              if (bundle === undefined) {
                return yield* new SourceProviderError({
                  provider: import.meta.url,
                  message: "Local Worker build produced no bundle.",
                });
              }
              return {
                mode: "bundle" as const,
                bundles: Stream.make({ _tag: "Success" as const, output: bundle }),
              };
            }),
        };
      }),
    ),
} satisfies WorkerSourceModule;
