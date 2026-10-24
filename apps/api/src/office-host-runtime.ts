import { Effect, Scope } from "effect";
import { createOfficeMetadata } from "@starter/office-cloudflare/metadata";
import { initializeOfficeStorageSchema } from "./office-storage-schema.ts";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type * as cf from "@cloudflare/workers-types";
import type { OwnerScope } from "@starter/office-server/ports";
import type { OfficeInvocationRegistry } from "./office-invocations.ts";
import type { OfficeNamespace } from "./office-private-bindings.ts";
import { officeStorageLoopback } from "./office-loopback.ts";
import { officeHostPolicy } from "./office-host-policy.ts";
import { officeHostProcess } from "./office-host-process.ts";
import { officeHostPlacements } from "./office-host-placements.ts";
import { officeHostFrameIO } from "./office-host-frame-io.ts";
import { officeDenied } from "./office-private-authority.ts";
import { closeOfficeHost } from "./office-host-shutdown.ts";
import type { OfficeHostActive, OfficeHostRuntime } from "./office-host-state.ts";

export async function officeHostRuntime(
  state: cf.DurableObjectState,
  owner: OwnerScope,
  registry: OfficeInvocationRegistry,
  namespace: OfficeNamespace,
  resources: Pick<OfficeProviderOptions, "database" | "bucket">,
  imageRef: string,
  retireIdle: boolean,
): Promise<OfficeHostRuntime> {
  const scope = await Effect.runPromise(Scope.make());
  const policy = officeHostPolicy(imageRef, owner.stage);
  const process = officeHostProcess(
    state,
    scope,
    imageRef,
    owner,
    policy,
    officeStorageLoopback(state, namespace),
  );
  const self = namespace.get(state.id);
  let active: Promise<OfficeHostActive> | undefined;
  let closing: Promise<void> | undefined;
  let resolveStopped: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });
  const root: OfficeHostRuntime = {
    state,
    owner,
    registry,
    namespace,
    self,
    policy,
    process,
    bootIO: officeHostFrameIO(),
    entries: new Map(),
    channels: new Map(),
    consumed: new Map(),
    nativeAttempts: new Map(),
    closing: false,
    binaryActive: 0,
    stopped,
    markStopped() {
      resolveStopped?.();
    },
    active() {
      if (root.closing || root.bootIO.isRevoked) return Promise.reject(officeDenied());
      active ??= Promise.resolve().then(async () => {
        await initializeOfficeStorageSchema(resources.database);
        const actual = await process.start(); // Ready callback NEVER waits on this promise.
        if (root.closing || root.bootIO.isRevoked) throw officeDenied();
        const options = {
          ...resources,
          stage: owner.stage,
          limits: policy.limits,
          workerId: actual.bootId,
          editorTtlMs: 120_000, // Initial channel is still capped by the original 120s invocation.
        };
        const metadata = createOfficeMetadata(options);
        const stop = () => {
          state.waitUntil(root.close().catch(() => undefined));
        };
        const placements = officeHostPlacements(
          options,
          metadata,
          owner,
          process,
          self,
          retireIdle ? policy.limits.cacheTtlSeconds : null,
          stop,
        );
        actual.signal.addEventListener("abort", stop, { once: true });
        if (actual.signal.aborted) stop();
        return { options, metadata, placements, nodeId: actual.bootId };
      });
      void active.catch(() => {
        state.waitUntil(root.close().catch(() => undefined));
      });
      return active;
    },
    close() {
      if (closing !== undefined) return closing;
      closing = Promise.resolve().then(() => closeOfficeHost(root, active));
      root.closing = true; // Publish close BEFORE abort/reentry or callbacks.
      return closing;
    },
  };
  return root;
}
