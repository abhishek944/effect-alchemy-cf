import * as Cloudflare from "alchemy/Cloudflare";
import { Effect } from "effect";
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
import { officeDenied } from "./office-private-authority.ts";
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
  const fetch = Effect.gen(function* () {
    const request = yield* Cloudflare.Request;
    const url = new URL(request.url);
    const resources = yield* officeStorageBindings;
    if (role[0] === "office-job") {
      if (url.origin !== "http://office-job.internal") return yield* Effect.fail(officeDenied());
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
      return yield* Effect.fail(officeDenied());
    const namespace = yield* officePrivateNamespace;
    runtime ??= officeHostRuntime(state, role[1], registry, namespace, resources, imageRef);
    const root = yield* Effect.tryPromise({
      try: () => runtime ?? Promise.reject(officeDenied()),
      catch: officeDenied,
    });
    actualRoot = root;
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
    Effect.catchCause(() =>
      Effect.succeed(
        HttpServerResponse.jsonUnsafe(safeFailure("OUTCOME_UNKNOWN"), { status: 503 }),
      ),
    ),
  );
  return {
    fetch,
    registerTask: (selector: OfficeTaskSelector, observeOnly: boolean) =>
      Effect.gen(function* () {
        if (role[0] !== "office-host" || actualRoot?.closing || typeof observeOnly !== "boolean")
          return yield* Effect.fail(officeDenied());
        const resources = yield* officeStorageBindings;
        const readProof = yield* officeTaskProofReader;
        return yield* registry.registerTask(
          selector,
          readProof,
          { ...resources, stage: role[1].stage },
          observeOnly,
        );
      }),
    get closing() {
      return actualRoot?.closing ?? false;
    },
  };
}
