import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { AlchemyContext } from "alchemy/AlchemyContext";
import { Stack } from "alchemy/Stack";
import { officeImageReference } from "./office-image.ts";
import { Config, Effect } from "effect";

/** One immutable APPLICATION image, containing host AND fixed job entries.
 * This declares configuration only; inspect/boot/readiness checks remain runtime obligations.
 */
export class OfficeApplication extends Cloudflare.Container<OfficeApplication>()(
  "OfficeApplication",
  Effect.gen(function* () {
    const image = yield* Config.String("OFFICE_IMAGE_REF");
    const stack = yield* Stack;
    const local = globalThis.__ALCHEMY_RUNTIME__
      ? (yield* Config.String("AUTH_LOCAL")) === "yes"
      : (yield* AlchemyContext).dev;
    if (!officeImageReference(image, local ? stack.stage : "cloud"))
      throw new Error("Office requires an immutable application image for the selected stage.");
    return {
      image,
      schedulingPolicy: "default" as const,
      instanceType: "standard-2" as const,
      instances: 0,
      maxInstances: 20,
      secrets: [],
      environmentVariables: [],
      ports: [{ name: "office", port: 8080 }],
    };
  }),
) {}

/**
 * The actual Alchemy Container Binding half for a pre-built image, without the eager
 * start/monitor of `Cloudflare.Containers.layer`: it binds the application to the hosting
 * OfficeHost namespace and marks that class container-backed on the Worker script.
 *
 * The frozen host lifetime still owns `state.container.interceptOutboundHttp`,
 * `start({ entrypoint, labels, env })` and `monitor()` on port 8080, so this MUST NOT start
 * or probe the process. Yield it from OfficeHost.make's init (which owns DurableObjectScope).
 */
export const officeApplicationBinding = Effect.gen(function* () {
  const application = yield* OfficeApplication.Application;
  const namespace = yield* Cloudflare.DurableObjectScope;
  const worker = yield* Cloudflare.Worker;
  const image = yield* Config.String("OFFICE_IMAGE_REF");
  const stage = globalThis.__ALCHEMY_RUNTIME__
    ? yield* Config.String("OBS_STAGE")
    : (yield* Stack).stage;
  yield* application.bind`${namespace}`({ durableObjects: { namespaceId: namespace.namespaceId } });
  yield* worker.bind`${application.LogicalId}`({
    containers: [
      {
        className: namespace.name,
        dev: stage === "dev_local" ? { tag: image } : application.dev,
        hash: application.hash.pipe(Output.map((built) => built?.image)),
      },
    ],
  });
});
