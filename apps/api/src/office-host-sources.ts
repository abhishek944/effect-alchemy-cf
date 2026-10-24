import { Effect } from "effect";
import { OfficeSourceReadRequest, decodeWireSync } from "@starter/office-contract";
import {
  readOfficeDocumentSources,
  readOfficeOriginalTarget,
} from "@starter/office-cloudflare/metadata";
import type { OfficeHostActive, OfficeHostRuntime } from "./office-host-state.ts";
import type { OfficeInvocation } from "./office-invocations.ts";
import { officeHostOriginal } from "./office-host-auth.ts";
import { officeCaught, officeDenied } from "./office-private-authority.ts";
import { officeReportBranch } from "./office-diagnostic-report.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";

/** Human-only binding audience; identifiers/descriptive Targets are never authorization. */
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
        decodeWireSync(OfficeSourceReadRequest)(
          await readOfficePrivateJson(request.body, request.signal, original.deadline, 2048),
        ),
      catch: officeCaught,
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
    const value = yield* "fileRef" in input
      ? readOfficeOriginalTarget(active.options, original.actor.owner, input)
      : readOfficeDocumentSources(
          active.options,
          original.actor.owner,
          input.documentId,
          input.cursor,
        );
    yield* live; // Actual IO settles before eligibility; original session/deadline, never renewal.
    return yield* Effect.try({
      try: () => {
        const body = JSON.stringify(value); // Each metadata reader validates its own finite DTO.
        if (new TextEncoder().encode(body).byteLength > 12 * 1024) throw officeDenied();
        return new Response(body, { headers: { "content-type": "application/json" } });
      },
      catch: officeCaught,
    });
  }).pipe(
    Effect.mapError((error) =>
      officeReportBranch(error, {
        component: "office.sources",
        operation: "read",
        reason: "source-read-rejected",
        eventId: original.actor.invocationId,
      }),
    ),
  );
