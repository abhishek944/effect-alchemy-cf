import { Effect } from "effect";
import { createCoordinatorControl } from "@starter/office-cloudflare/coordinator-control";
import type { CoordinatorControl } from "@starter/office-cloudflare/coordinator-control";
import type { OfficeProviderOptions } from "@starter/office-cloudflare/metadata";
import type { OfficeMetadata, OwnerScope } from "@starter/office-server/ports";
import type * as cf from "@cloudflare/workers-types";
import type { OfficeHostProcess } from "./office-host-process.ts";
import { officePrivateDigest } from "./office-private-placement.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeNativeSignal } from "./office-platform.ts";

export type OfficePlacement = NonNullable<
  Effect.Success<ReturnType<CoordinatorControl["placement"]>>
>;
type Lease = {
  value: OfficePlacement;
  timer?: ReturnType<typeof setTimeout>;
  polling?: Promise<void>;
};
const documentKey = (value: OfficePlacement) => ({
  owner: value.owner,
  documentId: value.documentId,
  unitId: value.unitId,
});
/** Hosting-only lease of the ACTUAL owned CF process. Never extends an Actor/View/native turn.
 * Fresh private self-events verify the physical cohort before each original unexpired renewal.
 */
export function officeHostPlacements(
  options: OfficeProviderOptions,
  metadata: OfficeMetadata,
  owner: OwnerScope,
  process: OfficeHostProcess,
  self: cf.Fetcher,
  idleSeconds: number | null,
  onStop: () => void,
) {
  const acquisitions = new Map<string, Promise<Lease>>();
  const leases = new Map<string, Lease>();
  const pending = new Set<Promise<void>>();
  const stop = new AbortController();
  let closed = false,
    failed = false,
    lastUsed = Date.now();
  const currentProcess = async () => process.peer(await process.bootId, false);
  const control = async (documentId: string) => {
    const actual = await currentProcess();
    const document = await Effect.runPromise(metadata.document(owner, documentId));
    if (document === null) throw officeDenied();
    return createCoordinatorControl(options, {
      kind: "placement",
      nodeId: actual.bootId,
      document: { owner, documentId, unitId: document.unitId },
      authorizationDigest: await officePrivateDigest([
        "office-host-placement",
        1,
        owner,
        documentId,
        actual.bootId,
      ]),
      notAfter: Date.now() + 30_000,
    });
  };
  const schedule = (lease: Lease) => {
    if (closed || failed) return;
    lease.timer = setTimeout(
      () => {
        if (idleSeconds !== null && Date.now() - lastUsed >= idleSeconds * 1000) {
          onStop();
          return;
        }
        const actual = Promise.resolve().then(async () => {
          const signal = AbortSignal.any([
            stop.signal,
            AbortSignal.timeout(Math.max(0, lease.value.until - Date.now())),
          ]);
          const response = await self.fetch("http://office-maintenance.internal/placement", {
            method: "POST",
            redirect: "manual",
            signal: officeNativeSignal(signal),
            body: JSON.stringify({ documentId: lease.value.documentId }),
            headers: { "content-type": "application/json" },
          });
          await readOfficePrivateJson(response.body, signal, lease.value.until, 16 * 1024);
          if (response.status !== 200) throw officeDenied();
          schedule(lease); // Only after the actual original renewal ACK. Never retry an unknown renewal.
          return undefined;
        });
        lease.polling = actual;
        void actual.catch(() => {
          failed = true;
          onStop();
        });
      },
      Math.min(10_000, Math.max(1, lease.value.until - Date.now() - 5000)),
    );
  };
  return {
    async current(documentId: string): Promise<OfficePlacement> {
      if (closed || failed) throw officeDenied();
      lastUsed = Date.now();
      let acquired = acquisitions.get(documentId);
      if (acquired === undefined) {
        if (acquisitions.size >= 16) throw officeDenied();
        acquired = Promise.resolve().then(async () => {
          const resource = await currentProcess();
          const doc = await Effect.runPromise(metadata.document(owner, documentId));
          if (doc === null) throw officeDenied();
          const document = { owner, documentId, unitId: doc.unitId };
          const provider = await control(documentId);
          const previous = await Effect.runPromise(provider.placement(document));
          if (previous !== null && previous.state === "live" && previous.until > Date.now())
            throw officeDenied();
          const value = await Effect.runPromise(
            provider.place(document, {
              kind: "claim",
              id: crypto.randomUUID(),
              nodeId: resource.bootId,
              expectedServiceEpoch: previous?.serviceEpoch ?? null,
              until: Date.now() + 29_000,
            }),
          );
          const lease = { value };
          leases.set(documentId, lease);
          await currentProcess();
          if (closed || failed) throw officeDenied();
          schedule(lease);
          return lease;
        });
        acquisitions.set(documentId, acquired); // Keep a rejected first ACK; NEVER read/reclaim to recover it.
      }
      const lease = await acquired;
      if (closed || failed || lease.value.until <= Date.now()) throw officeDenied();
      await currentProcess();
      return lease.value;
    },
    renew(documentId: string): Promise<void> {
      const actual = Promise.resolve().then(async () => {
        await currentProcess();
        const lease = leases.get(documentId);
        if (closed || failed || lease === undefined || lease.value.until <= Date.now())
          throw officeDenied();
        const provider = await control(documentId);
        lease.value = await Effect.runPromise(
          provider.place(documentKey(lease.value), {
            kind: "renew",
            id: lease.value.id,
            serviceEpoch: lease.value.serviceEpoch,
            until: Date.now() + 29_000,
          }),
        );
        await currentProcess();
        return undefined;
      });
      const joined = actual.then(
        () => undefined,
        () => undefined,
      );
      pending.add(joined);
      void joined.then(() => pending.delete(joined));
      return actual;
    },
    async stop() {
      closed = true;
      stop.abort();
      for (const lease of leases.values()) clearTimeout(lease.timer);
      await Promise.allSettled([...leases.values()].map((lease) => Promise.resolve(lease.polling)));
      await Promise.allSettled(acquisitions.values());
      while (pending.size > 0) await Promise.all(pending);
      if (failed) throw officeDenied();
    },
    async retire() {
      await process.close(); // Actual original image/process monitor/destroy join, not a boolean proof.
      const results = await Promise.allSettled(
        [...leases.values()].map(async (lease) => {
          const provider = createCoordinatorControl(options, {
            kind: "placement",
            nodeId: lease.value.nodeId,
            document: { owner, documentId: lease.value.documentId, unitId: lease.value.unitId },
            authorizationDigest: await officePrivateDigest(["office-retire", 1, lease.value.id]),
            notAfter: Date.now() + 30_000,
          });
          await Effect.runPromise(
            provider.place(documentKey(lease.value), {
              kind: "retire",
              id: lease.value.id,
              serviceEpoch: lease.value.serviceEpoch,
            }),
          );
        }),
      );
      if (results.some((item) => item.status === "rejected")) throw officeDenied();
    },
  };
}
export type OfficeHostPlacements = ReturnType<typeof officeHostPlacements>;
