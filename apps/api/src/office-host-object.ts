import { Auth } from "@starter/auth";
import type { RuntimeContext } from "alchemy";
import { AuthLive } from "@starter/auth/cloudflare";
import { OfficeSessionEpochs, type OfficeSessionBinding } from "@starter/auth/office-session";
import {
  OfficeErrors,
  OfficeForbidden,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { OwnerClaims } from "@starter/office-server/ports";
import * as Cloudflare from "alchemy/Cloudflare";
import { Config, Effect, Schema } from "effect";
import type { Scope } from "effect";
import type { HttpServerResponse } from "effect/http/HttpServerResponse";
import { officeApplicationBinding } from "./office-container.ts";
import { OfficeHostRole } from "./office-host-role.ts";
import { officeHostFetch } from "./office-host-fetch.ts";
import type { OfficeError } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { OfficeInvocationRegistry } from "./office-invocations.ts";
import { CurrentOfficeSession } from "./office-authentication.ts";
import type { OfficeTaskSelector } from "./office-task-proof.ts";

export const officeHostName = (owner: OwnerScope): string =>
  JSON.stringify(["office-host", decodeWireSync(OwnerClaims)(owner)]);

type OfficeHostShape = {
  /** Actual binding callback proves original executing tool; no session/actor supplied by caller. */
  readonly registerTask: (
    selector: OfficeTaskSelector,
    observeOnly: boolean,
  ) => Effect.Effect<
    { readonly invocationId: string; readonly deadline: number },
    OfficeError,
    RuntimeContext | Cloudflare.WorkerEnvironment
  >;
  readonly fetch: Effect.Effect<
    HttpServerResponse,
    never,
    RuntimeContext | Cloudflare.WorkerEnvironment | Cloudflare.Request | Scope.Scope
  >;
  /** Binding-only server registration. No HTTP endpoint accepts an association. */
  readonly registerHuman: (
    original: OfficeSessionBinding,
  ) => Effect.Effect<
    { readonly invocationId: string; readonly deadline: number },
    OfficeError,
    RuntimeContext
  >;
};

/** One container-backed namespace: warm document host and separate fresh isolated job roles. */
export class OfficeHost extends Cloudflare.DurableObject<OfficeHost, OfficeHostShape>()(
  "OfficeHost",
  { errors: OfficeErrors },
) {}

/** Initialize in the Worker, execute ONLY behind OfficeAuthentication in each request. */
export const makeOfficeHumanRegistrar = Effect.gen(function* () {
  const hosts = yield* OfficeHost;
  return Effect.gen(function* () {
    const original = yield* CurrentOfficeSession;
    yield* original.revalidate.pipe(
      Effect.catchTag("OfficeSessionDenied", () =>
        Effect.fail(new OfficeForbidden(safeFailure("FORBIDDEN"))),
      ),
      Effect.catchTag("OfficeSessionUnavailable", () =>
        Effect.fail(new OfficeUnavailable(safeFailure("UNAVAILABLE"))),
      ),
    );
    const host = hosts.getByName(
      officeHostName({ stage: original.stage, ownerId: original.ownerId }),
    );
    // Only original metadata crosses the private binding; never its Headers/Effect/cookie/token.
    const issued = yield* host.registerHuman({
      stage: original.stage,
      ownerId: original.ownerId,
      sessionId: original.sessionId,
      sessionEpoch: original.sessionEpoch,
      expiresAt: original.expiresAt,
    });
    return { host, ...issued };
  });
});

export default OfficeHost.make(
  Effect.gen(function* () {
    const state = yield* Cloudflare.DurableObjectState;
    yield* officeApplicationBinding;
    const imageRef = yield* Config.String("OFFICE_IMAGE_REF").pipe(Effect.orDie);
    const stage = yield* Config.String("OBS_STAGE").pipe(Effect.orDie);
    const auth = yield* Auth;
    const epochs = yield* OfficeSessionEpochs;
    return Effect.sync(() => {
      const name = state.id.name;
      if (name === undefined) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      const role = decodeWireSync(Schema.fromJsonString(OfficeHostRole))(name);
      const owner = role[1];
      if (owner.stage !== stage) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      const registry = new OfficeInvocationRegistry(owner);
      const runtime = officeHostFetch(state.raw, role, registry, imageRef);
      return {
        fetch: runtime.fetch.pipe(
          Effect.provideService(Auth, auth),
          Effect.provideService(OfficeSessionEpochs, epochs),
        ),
        registerTask: (selector: OfficeTaskSelector, observeOnly: boolean) =>
          runtime.registerTask(selector, observeOnly).pipe(
            Effect.map(({ actor, deadline }) => ({ invocationId: actor.invocationId, deadline })),
            Effect.provideService(Auth, auth),
            Effect.provideService(OfficeSessionEpochs, epochs),
          ),
        registerHuman: (original: OfficeSessionBinding) =>
          (role[0] !== "office-host" || runtime.closing
            ? Effect.fail(new OfficeForbidden(safeFailure("FORBIDDEN")))
            : registry.registerHuman(original)
          ).pipe(
            Effect.map(({ actor, deadline }) => ({ invocationId: actor.invocationId, deadline })),
            Effect.provideService(Auth, auth),
            Effect.provideService(OfficeSessionEpochs, epochs),
          ),
      };
    });
  }).pipe(Effect.provide(AuthLive), Effect.provide(OfficeSessionEpochs.layer), Effect.orDie),
);
