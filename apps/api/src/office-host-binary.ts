import { reportFailure, withCause } from "@starter/diagnostics";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { officePrivateBinary } from "./office-private-binary.ts";
import type { OfficePrivateIO } from "./office-private-authority.ts";
import type { OfficeHostEntry, OfficeHostRuntime } from "./office-host-state.ts";

/** Bound simultaneous 4 MiB opaque piece buffers; release only after ACTUAL outgoing/body joins. */
export async function officeHostBinary(
  root: OfficeHostRuntime,
  entry: OfficeHostEntry,
  body: ReadableStream<Uint8Array> | null,
) {
  if (root.binaryActive >= 8) throw new OfficeUnavailable(safeFailure("BUSY"));
  root.binaryActive++;
  const resources = new Set<OfficePrivateIO>();
  const request = {
    ...entry.frame.request,
    keepIO(resource: OfficePrivateIO, cleanup: boolean) {
      resources.add(resource);
      entry.frame.request.keepIO(resource, cleanup);
    },
  };
  let responded = false;
  try {
    const active = await root.active();
    const response = await officePrivateBinary(
      body,
      request,
      entry.backend,
      active.metadata,
      root.policy.limits,
    );
    responded = true;
    return response;
  } finally {
    const release = Promise.resolve()
      .then(async () => {
        if (!responded)
          await Promise.allSettled([...resources].map((resource) => resource.close()));
        const results = await Promise.allSettled(
          [...resources].map((resource) => resource.drain()),
        );
        const rejected = results.filter((result) => result.status === "rejected");
        if (rejected.length)
          throw withCause(
            new OfficeUnavailable(safeFailure("UNAVAILABLE")),
            new AggregateError(
              rejected.map((result): unknown => result.reason),
              "Binary resource drain failed",
            ),
          );
        return undefined;
      })
      .finally(() => {
        root.binaryActive--;
      });
    root.state.waitUntil(
      release
        .catch((cause) => {
          if (!root.closing)
            reportFailure(cause, {
              component: "office.host",
              operation: "cleanup-escalation",
              reason: "binary-resource-drain",
              eventId: entry.frame.id,
            });
          return root.close();
        })
        .catch(() => undefined),
    );
  }
}
