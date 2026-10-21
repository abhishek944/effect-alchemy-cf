import { officeDenied } from "./office-private-authority.ts";
import { closeOfficeHostEntry } from "./office-host-entry.ts";
import { closeOfficeHostChannel } from "./office-host-channel.ts";
import type { OfficeHostActive, OfficeHostRuntime } from "./office-host-state.ts";

/** Node/SDK graceful scope close, independent owned jobs, then actual kernel close and Worker IO. */
export async function closeOfficeHost(
  root: OfficeHostRuntime,
  opening: Promise<OfficeHostActive> | undefined,
) {
  for (const entry of root.entries.values()) entry.frame.revoke();
  const active = await opening?.catch(() => undefined);
  const jobs = Promise.allSettled(
    [...root.entries.values()].map((entry) => entry.backend.jobs.close()),
  );
  const placementStop = active?.placements.stop();
  let forceTimer: ReturnType<typeof setTimeout> | undefined;
  const physical = new Promise<void>((resolve, reject) => {
    // A deadline INITIATES actual destruction; it never resolves the physical-completion promise.
    forceTimer = setTimeout(() => {
      void root.process.close().then(resolve, reject);
    }, 10_000);
  });
  const graceful = Promise.resolve().then(async () => {
    if (active === undefined) {
      await root.process.close();
      return undefined;
    }
    const bootId = await root.process.bootId;
    const response = await root.process.request(
      new Request("http://office-node.internal/__office/shutdown", {
        method: "POST",
        headers: { "x-office-boot": bootId },
        redirect: "manual",
      }),
    );
    if (response.body !== null) {
      const reader = response.body.getReader();
      const closed = reader.closed.then(
        () => true,
        () => false,
      );
      const cancellation = Promise.resolve()
        .then(() => reader.cancel())
        .then(
          () => true,
          () => false,
        );
      // Both observed promises fulfill booleans, so lock release also precedes failure propagation.
      const [cancelled, ended] = await Promise.all([cancellation, closed]);
      reader.releaseLock();
      if (!cancelled || !ended) throw officeDenied();
    }
    // A forced process cannot report stopped. This races logical reports only, never body joins.
    await Promise.race([root.stopped, physical]);
    await root.bootIO.drain();
    await root.process.close();
    return undefined;
  });
  const kernel = await Promise.allSettled([
    Promise.race([graceful.catch(() => physical), physical]),
  ]);
  clearTimeout(forceTimer);
  // Initiate callback cancellation BEFORE joining a graceful drain still waiting after forced close.
  root.bootIO.stop();
  const gracefulJoined = await Promise.allSettled([graceful]);
  await jobs;
  // Provider/bindings stay alive through independently owned Worker bodies and pending SQL/R2.
  for (const entry of root.entries.values()) entry.frame.stopCleanup();
  const channels = await Promise.allSettled(
    [...root.channels.values()].map((channel) => closeOfficeHostChannel(root, channel)),
  );
  const frames = await Promise.allSettled(
    [...root.entries.values()].map((entry) => closeOfficeHostEntry(root, entry)),
  );
  const providers = await Promise.allSettled(
    [...root.entries.values()].map((entry) => entry.backend.drain()),
  );
  const stopped = await Promise.allSettled([
    placementStop,
    root.bootIO.drain(),
    active?.placements.retire(),
  ]);
  if (
    [...kernel, ...gracefulJoined, ...channels, ...frames, ...providers, ...stopped].some(
      (result) => result.status === "rejected",
    )
  )
    throw officeDenied();
}
