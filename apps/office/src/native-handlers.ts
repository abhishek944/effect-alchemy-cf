import { finished } from "node:stream/promises";
import { Effect } from "effect";
import { OfficeForbidden, safeFailure } from "@starter/office-contract";
import { classifyNativeRoute } from "@starter/office-server/native-protocol";
import type { OfficeDependencies, OwnerScope } from "@starter/office-server/ports";
import type { makeNativeApplication } from "./native-app.ts";
import type { makeOfficeProtocolPool } from "./native-protocol-pool.ts";
import type { OfficeRequestContext } from "./native-request-context.ts";
import type { OfficeProtocolTasks } from "./native-protocol-tasks.ts";
import type { OfficeNodeHandlers } from "./native-listener-types.ts";
import type { ResolveOfficeIngress } from "./native-handler-types.ts";
import { resolveNativeView } from "./native-app-view.ts";
import { handleOfficeControl } from "./native-office-http.ts";

const denied = () => new OfficeForbidden(safeFailure("FORBIDDEN"));
/** Real17 application handlers.15 owns Node IO only; T47 supplies the genuine original private issuer. */
export function createOfficeNodeHandlers(options: {
  readonly application: Effect.Success<ReturnType<typeof makeNativeApplication>>;
  readonly pool: Effect.Success<ReturnType<typeof makeOfficeProtocolPool>>;
  readonly context: OfficeRequestContext;
  readonly tasks: OfficeProtocolTasks;
  readonly dependencies: OfficeDependencies;
  readonly owner: OwnerScope;
  /** Bind supplied listener signal into ALL actual per-invocation channel profiles; never mint authority here. */
  readonly resolve: ResolveOfficeIngress;
}): OfficeNodeHandlers {
  async function protocol(viewId: string, signal: AbortSignal) {
    const view = await Effect.runPromise(
      resolveNativeView(options.dependencies, options.owner, viewId, signal),
    );
    const value = await options.pool.get(viewId);
    return { view, value };
  }
  return {
    async request(request, response, signal) {
      options.tasks.assertActive();
      const original = request.url;
      const route =
        original === "/__office/core" && request.method === "POST"
          ? null
          : classifyNativeRoute(request.method ?? "", original ?? "");
      if (original !== "/__office/core" && route === null) throw denied();
      if (
        request.method === "GET" &&
        (request.headers["transfer-encoding"] !== undefined ||
          (request.headers["content-length"] !== undefined &&
            request.headers["content-length"] !== "0"))
      )
        throw denied();
      const binding = await options.resolve(request, signal);
      await options.context.run(binding.channels, async () => {
        const linked = AbortSignal.any([signal, binding.signal]);
        options.tasks.assertActive();
        linked.throwIfAborted();
        if (!Number.isSafeInteger(binding.deadline) || Date.now() >= binding.deadline)
          throw denied();
        if (binding.kind === "core") {
          if (
            original !== "/__office/core" ||
            binding.actor.owner.ownerId !== options.owner.ownerId ||
            binding.actor.owner.stage !== options.owner.stage
          )
            throw denied();
          await handleOfficeControl(request, response, options.application.office, {
            ...binding,
            signal: linked,
          });
          return;
        }
        if (
          route === null ||
          (route.params.viewID !== undefined && route.params.viewID !== binding.viewId)
        )
          throw denied();
        const { view, value } = await protocol(binding.viewId, linked);
        if (route.params.unitID !== undefined && route.params.unitID !== view.target.unitId)
          throw denied();
        if (
          route.params.worktreeID !== undefined &&
          (view.source.kind !== "draft" || route.params.worktreeID !== view.source.worktreeId)
        )
          throw denied();
        const prefix = "/api/office/views/" + binding.viewId + "/protocol";
        // Exact authenticated live-only prefix mapping; persisted View prefix, pinned/draft identity stay unchanged.
        if (
          original?.startsWith(prefix + "/snapshot/") &&
          view.view.nativeTarget.kind !== "pinned-snapshot" &&
          view.source.kind !== "artifact"
        )
          request.url =
            (view.source.kind === "draft"
              ? "/universer-api/worktrees/" + view.source.worktreeId
              : "/universer-api") + original.slice(prefix.length);
        const responseDone = finished(response, { cleanup: true }).then(
          (): PromiseFulfilledResult<void> => ({ status: "fulfilled", value: undefined }),
          (reason: unknown): PromiseRejectedResult => ({ status: "rejected", reason }),
        );
        const task = options.tasks.request(request);
        try {
          value.transport.handleRequest(request, response);
          const work = await Promise.allSettled([task.join()]);
          const sent = await responseDone;
          const settled = work[0];
          if (settled?.status === "rejected") throw settled.reason;
          if (sent.status === "rejected") throw sent.reason;
        } finally {
          request.url = original;
        }
      });
    },
    async upgrade(request, socket, head, signal) {
      options.tasks.assertActive();
      const route = classifyNativeRoute("UPGRADE", request.url ?? "");
      if (request.method !== "GET" || route === null) throw denied();
      const binding = await options.resolve(request, signal);
      await options.context.run(binding.channels, async () => {
        if (binding.kind !== "protocol") throw denied();
        const linked = AbortSignal.any([signal, binding.signal]);
        linked.throwIfAborted();
        if (!Number.isSafeInteger(binding.deadline) || Date.now() >= binding.deadline)
          throw denied();
        const { view, value } = await protocol(binding.viewId, linked);
        if (
          route.params.worktreeID !== undefined &&
          (view.source.kind !== "draft" || view.source.worktreeId !== route.params.worktreeID)
        )
          throw denied();
        const task = options.tasks.request(request);
        value.transport.handleUpgrade(request, socket, head); // Genuine raw101/socket; no fetch conversion/retry.
        await task.join();
      });
    },
    revoke() {
      options.tasks.revoke();
      options.pool.revoke();
    },
    async drain() {
      await options.tasks.drain();
      options.context.assertClean();
    },
  };
}
