import { Effect } from "effect";
import { OfficeSourcePage, OfficeSourceRequest, decodeWireSync } from "@starter/office-contract";
import { readOfficeDocumentSources } from "@starter/office-cloudflare/metadata";
import type { OfficeHostActive, OfficeHostRuntime } from "./office-host-state.ts";
import type { OfficeInvocation } from "./office-invocations.ts";
import { officeHostOriginal } from "./office-host-auth.ts";
import { officeDenied } from "./office-private-authority.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";

/** Human-only binding audience; IDs and decoded source metadata are never authorization. */
export const officeHostSources = (
  root: OfficeHostRuntime,
  active: OfficeHostActive,
  original: OfficeInvocation,
  request: Request,
) =>
  Effect.gen(function* () {
    if (original.actor.capability !== "human" || request.method !== "POST")
      return yield* Effect.fail(officeDenied());
    const input = yield* Effect.tryPromise({
      try: async () =>
        decodeWireSync(OfficeSourceRequest)(
          await readOfficePrivateJson(request.body, request.signal, original.deadline, 2048),
        ),
      catch: officeDenied,
    });
    const live = Effect.gen(function* () {
      if (
        request.signal.aborted ||
        root.closing ||
        (yield* officeHostOriginal(root, original.actor.invocationId)) !== original
      )
        return yield* Effect.fail(officeDenied());
      return undefined;
    });
    yield* live;
    const value = yield* readOfficeDocumentSources(
      active.options,
      original.actor.owner,
      input.documentId,
      input.cursor,
    );
    yield* live; // Actual provider settlement precedes eligibility; no abort race or renewed session.
    return yield* Effect.try({
      try: () => {
        const body = JSON.stringify(decodeWireSync(OfficeSourcePage)(value));
        if (new TextEncoder().encode(body).byteLength > 12 * 1024) throw officeDenied();
        return new Response(body, { headers: { "content-type": "application/json" } });
      },
      catch: officeDenied,
    });
  });
