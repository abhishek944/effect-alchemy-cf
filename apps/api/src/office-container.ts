import * as Cloudflare from "alchemy/Cloudflare";
import * as Output from "alchemy/Output";
import { Config, Effect } from "effect";

/** One operator-supplied immutable APPLICATION image, containing host AND fixed job entries.
 * This declares configuration only; inspect/boot/readiness checks remain runtime obligations.
 */
export class OfficeApplication extends Cloudflare.Container<OfficeApplication>()(
  "OfficeApplication",
  Effect.gen(function* () {
    const image = yield* Config.String("OFFICE_IMAGE_REF");
    if (!/^registry\.cloudflare\.com\/[^\s@]+@sha256:[a-f0-9]{64}$/.test(image))
      throw new Error("Office requires an actual published immutable application image.");
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
  yield* application.bind`${namespace}`({ durableObjects: { namespaceId: namespace.namespaceId } });
  yield* worker.bind`${application.LogicalId}`({
    containers: [
      {
        className: namespace.name,
        dev: application.dev,
        hash: application.hash.pipe(Output.map((image) => image?.image)),
      },
    ],
  });
});
