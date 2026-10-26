import { diagnosticMetadata, withCause } from "@starter/diagnostics";
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
import type { DraftTarget, OfficeError, Receipt } from "@starter/office-contract";
import type { OwnerScope } from "@starter/office-server/ports";
import { OfficeInvocationRegistry, type OfficeHumanPurpose } from "./office-invocations.ts";
import { officeDeny, officeReportCause } from "./office-diagnostic-report.ts";
import { CurrentOfficeSession } from "./office-authentication.ts";
import type { OfficeTaskSelector } from "./office-task-proof.ts";
import { officeCaught } from "./office-private-authority.ts";
import type { ChatReferenceInputs } from "@starter/office-contract";
import { validateOfficeReferenceTargets } from "./office-reference-validation.ts";

export const officeHostName = (owner: OwnerScope): string =>
  JSON.stringify(["office-host", decodeWireSync(OwnerClaims)(owner)]);

type OfficeHostShape = {
  /** Private metadata admission only: no actor, grant, native read or command is issued. */
  readonly validateReferences: (
    session: OfficeSessionBinding,
    inputs: ChatReferenceInputs,
  ) => Effect.Effect<true, OfficeError, RuntimeContext | Cloudflare.WorkerEnvironment>;
  /** Actual binding callback proves original executing tool; no session/actor supplied by caller. */
  readonly registerTask: (
    selector: OfficeTaskSelector,
    observeOnly: boolean,
  ) => Effect.Effect<
    {
      readonly invocationId: string;
      readonly deadline: number;
      readonly attachmentReceipt: Receipt | null;
      readonly referenceBasis?: DraftTarget;
    },
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
    purpose: OfficeHumanPurpose,
  ) => Effect.Effect<
    { readonly invocationId: string; readonly deadline: number },
    OfficeError,
    RuntimeContext | Cloudflare.WorkerEnvironment
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
  return (purpose: OfficeHumanPurpose = "request") =>
    Effect.gen(function* () {
      const original = yield* CurrentOfficeSession;
      yield* original.revalidate.pipe(
        Effect.catchTag("OfficeSessionDenied", () =>
          Effect.fail(new OfficeForbidden(safeFailure("FORBIDDEN"))),
        ),
        Effect.catchTag("OfficeSessionUnavailable", (cause) =>
          Effect.fail(withCause(new OfficeUnavailable(safeFailure("UNAVAILABLE")), cause)),
        ),
      );
      const host = hosts.getByName(
        officeHostName({ stage: original.stage, ownerId: original.ownerId }),
      );
      // Only original metadata crosses the private binding; never its Headers/Effect/cookie/token.
      const issued = yield* host.registerHuman(
        {
          stage: original.stage,
          ownerId: original.ownerId,
          sessionId: original.sessionId,
          sessionEpoch: original.sessionEpoch,
          expiresAt: original.expiresAt,
        },
        purpose,
      );
      return { host, ...issued };
    });
});

export default OfficeHost.make(
  Effect.gen(function* () {
    yield* officeApplicationBinding;
    const auth = yield* Auth;
    const epochs = yield* OfficeSessionEpochs;
    return Effect.gen(function* () {
      const state = yield* Cloudflare.DurableObjectState;
      const imageRef = yield* Config.String("OFFICE_IMAGE_REF").pipe(Effect.orDie);
      const stage = yield* Config.String("OBS_STAGE").pipe(Effect.orDie);
      const name = state.id.name;
      if (name === undefined) throw officeDeny({ operation: "host-init", reason: "owner-missing" });
      const role = decodeWireSync(Schema.fromJsonString(OfficeHostRole))(name);
      const owner = role[1];
      if (owner.stage !== stage)
        throw officeDeny({ operation: "host-init", reason: "stage-mismatch" });
      const registry = new OfficeInvocationRegistry(owner);
      const runtime = officeHostFetch(state.raw, role, registry, imageRef);
      return {
        validateReferences: (session: OfficeSessionBinding, inputs: ChatReferenceInputs) =>
          validateOfficeReferenceTargets(role, session, inputs).pipe(
            Effect.provideService(Auth, auth),
            Effect.provideService(OfficeSessionEpochs, epochs),
          ),
        fetch: runtime.fetch.pipe(
          Effect.provideService(Auth, auth),
          Effect.provideService(OfficeSessionEpochs, epochs),
        ),
        registerTask: (selector: OfficeTaskSelector, observeOnly: boolean) =>
          runtime.registerTask(selector, observeOnly).pipe(
            Effect.map(({ actor, deadline, task }) => ({
              invocationId: actor.invocationId,
              deadline,
              attachmentReceipt: task.binding.attachment?.operation.receipt ?? null,
              ...(task.binding.referenceBasis === undefined
                ? {}
                : { referenceBasis: task.binding.referenceBasis }),
            })),
            Effect.provideService(Auth, auth),
            Effect.provideService(OfficeSessionEpochs, epochs),
          ),
        registerHuman: (original: OfficeSessionBinding, purpose: OfficeHumanPurpose) =>
          Effect.gen(function* () {
            const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
            const report = {
              ...diagnosticMetadata(env),
              component: "office.admission",
              operation: "register-human",
            };
            if (role[0] !== "office-host")
              return yield* Effect.fail(officeDeny({ ...report, reason: "host-role" }));
            yield* Effect.tryPromise({ try: runtime.prepare, catch: officeCaught });
            if (runtime.closing)
              return yield* Effect.fail(officeDeny({ ...report, reason: "host-closing" }));
            const registered = yield* registry
              .registerHuman(original, purpose)
              .pipe(Effect.tapCause((cause) => officeReportCause(cause, report)));
            return { invocationId: registered.actor.invocationId, deadline: registered.deadline };
          }).pipe(
            Effect.provideService(Auth, auth),
            Effect.provideService(OfficeSessionEpochs, epochs),
          ),
      };
    });
  }).pipe(Effect.provide(AuthLive), Effect.provide(OfficeSessionEpochs.layer), Effect.orDie),
);
