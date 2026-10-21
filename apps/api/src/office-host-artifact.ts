import { Effect } from "effect";
import { createOfficeBytes } from "@starter/office-cloudflare/bytes";
import type { OfficeHostActive } from "./office-host-state.ts";
import type { OfficeInvocation } from "./office-invocations.ts";
import { officeDenied } from "./office-private-authority.ts";

/** Actual private immutable provider metadata; never aggregate/download native or file contents. */
export async function officeHostArtifact(
  active: OfficeHostActive,
  original: OfficeInvocation,
  id: string,
) {
  const value = await Effect.runPromise(
    createOfficeBytes(active.options).get(original.actor.owner, id),
  );
  if (value === null) throw officeDenied();
  const reader = value.body.getReader(); // Own immediately, before any post-open validation/await.
  const closed = reader.closed.then(
    () => true,
    () => false,
  );
  const cancellation = Promise.resolve().then(() => reader.cancel());
  const result = await Promise.allSettled([cancellation, closed]);
  let failed = result.some((item) => item.status === "rejected" || item.value === false);
  try {
    reader.releaseLock();
  } catch {
    failed = true;
  }
  if (failed) throw officeDenied();
  return value.ref;
}
