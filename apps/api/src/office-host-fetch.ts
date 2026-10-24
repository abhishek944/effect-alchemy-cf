import * as Cloudflare from "alchemy/Cloudflare";
import { Cause, Config, Effect } from "effect";
import { diagnosticMetadata } from "@starter/diagnostics";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import type * as cf from "@cloudflare/workers-types";
import { safeFailure } from "@starter/office-contract";
import type { OfficeInvocationRegistry } from "./office-invocations.ts";
import type { OfficeHostRole } from "./office-host-role.ts";
import { officeStorageBindings } from "./office-storage-bindings.ts";
import { officePrivateNamespace } from "./office-private-bindings.ts";
import { officeHostRuntime } from "./office-host-runtime.ts";
import { officeHostApi } from "./office-host-api.ts";
import { officeHostBootstrap, officeHostPrivate } from "./office-host-private.ts";
import { officeHostMaintenance } from "./office-host-maintenance.ts";
import { officeJobRole } from "./office-job-object.ts";
import { officeJobHttp } from "./office-job-http.ts";
import { officeCaught } from "./office-private-authority.ts";
import { officeDeny, officeReportCause } from "./office-diagnostic-report.ts";
import { officeTaskProofReader } from "./office-task-callback.ts";
import type { OfficeTaskSelector } from "./office-task-proof.ts";

/** Lazy PER-EVENT native bindings; never resolve raw D1/R2 at constructor/build time. */
export function officeHostFetch(
  state: cf.DurableObjectState,
  role: OfficeHostRole,
  registry: OfficeInvocationRegistry,
  imageRef: string,
) {
  let runtime: ReturnType<typeof officeHostRuntime> | undefined;
  let jobs: ReturnType<typeof officeJobRole> | undefined;
  let actualRoot: Awaited<ReturnType<typeof officeHostRuntime>> | undefined;
  // New admission may replace a successfully joined lifetime, never pending/failed cleanup.
  const prepare = async () => {
    const previous = runtime;
    const root = actualRoot;
    if (root?.closing !== true) return;
    await root.close();
    await root.process.actualGone;
    if (runtime === previous) {
      runtime = undefined;
      actualRoot = undefined;
    }
  };
  const fetch = Effect.gen(function* () {
    const request = yield* Cloudflare.Request;
    const url = new URL(request.url);
    const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
    const observed = diagnosticMetadata(env);
    const resources = yield* officeStorageBindings;
    if (role[0] === "office-job") {
      if (url.origin !== "http://office-job.internal")
        return yield* Effect.fail(
          officeDeny({
            ...observed,
            component: "office.worker",
            operation: "host-fetch",
            reason: "job-origin",
          }),
        );
      jobs ??= officeJobRole(
        state,
        imageRef,
        { ...resources, stage: role[1].stage },
        role[1],
        role[2],
        role[3],
      );
      return yield* officeJobHttp(jobs, request);
    }
    if (
      ![
        "http://office-api.internal",
        "http://office-node-callback.internal",
        "http://office-maintenance.internal",
      ].includes(url.origin)
    )
      return yield* Effect.fail(
        officeDeny({
          ...observed,
          component: "office.worker",
          operation: "host-fetch",
          reason: "private-origin",
        }),
      );
    // Original callbacks/maintenance keep their old root through shutdown; only API work resets it.
    if (url.origin === "http://office-api.internal")
      yield* Effect.tryPromise({ try: prepare, catch: officeCaught });
    const namespace = yield* officePrivateNamespace;
    const retireIdle =
      role[1].stage !== "dev_local" ||
      (yield* Config.Boolean("OFFICE_LOCAL_IDLE").pipe(Config.withDefault(false)));
    const current = (runtime ??= officeHostRuntime(
      state,
      role[1],
      registry,
      namespace,
      resources,
      imageRef,
      retireIdle,
    ));
    const root = yield* Effect.tryPromise({ try: () => current, catch: officeCaught });
    if (runtime === current) actualRoot = root;
    const response = yield* url.origin === "http://office-api.internal"
      ? officeHostApi(root, request)
      : url.origin === "http://office-maintenance.internal"
        ? officeHostMaintenance(root, request)
        : url.pathname.startsWith("/bootstrap/")
          ? officeHostBootstrap(root, request)
          : officeHostPrivate(root, request);
    // Alchemy's native raw Response path preserves real101/webSocket and streaming ownership.
    return HttpServerResponse.setBody(
      HttpServerResponse.empty({ status: response.status }),
      HttpBody.raw(response),
    );
  }).pipe(
    Effect.catchCause((cause) => {
      if (Cause.hasInterruptsOnly(cause))
        return Effect.failCause(
          Cause.fromReasons<never>(cause.reasons.filter(Cause.isInterruptReason)),
        );
      return Effect.gen(function* () {
        const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
        const current = new URL((yield* Cloudflare.Request).url);
        const phase =
          current.origin === "http://office-api.internal"
            ? "host-api"
            : current.origin === "http://office-maintenance.internal"
              ? "host-maintenance"
              : current.origin === "http://office-job.internal"
                ? "host-job"
                : current.origin === "http://office-node-callback.internal"
                  ? current.pathname.startsWith("/bootstrap/")
                    ? "host-bootstrap"
                    : "host-callback"
                  : "host-other";
        yield* officeReportCause(cause, {
          ...diagnosticMetadata(env),
          component: "office.worker",
          operation: "host-fetch",
          phase,
        });
        return HttpServerResponse.jsonUnsafe(safeFailure("OUTCOME_UNKNOWN"), { status: 503 });
      });
    }),
  );
  return {
    fetch,
    prepare,
    registerTask: (selector: OfficeTaskSelector, observeOnly: boolean) =>
      Effect.gen(function* () {
        const env: Readonly<Record<string, unknown>> = yield* Cloudflare.WorkerEnvironment;
        const metadata = diagnosticMetadata(env);
        const report = { ...metadata, component: "office.admission", operation: "register-task" };
        if (role[0] !== "office-host")
          return yield* Effect.fail(officeDeny({ ...report, reason: "host-role" }));
        yield* Effect.tryPromise({ try: prepare, catch: officeCaught });
        if (actualRoot?.closing)
          return yield* Effect.fail(officeDeny({ ...report, reason: "host-closing" }));
        if (typeof observeOnly !== "boolean")
          return yield* Effect.fail(officeDeny({ ...report, reason: "observation-invalid" }));
        // Sole final registerTask report owner: covers admission IO and the registry result once.
        return yield* Effect.gen(function* () {
          const resources = yield* officeStorageBindings;
          const readProof = yield* officeTaskProofReader;
          return yield* registry.registerTask(
            selector,
            readProof,
            { ...resources, stage: role[1].stage },
            observeOnly,
            metadata,
          );
        }).pipe(Effect.tapCause((cause) => officeReportCause(cause, report)));
      }),
    get closing() {
      return actualRoot?.closing ?? false;
    },
  };
}
