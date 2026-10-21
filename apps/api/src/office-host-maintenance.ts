import { Effect, Schema } from "effect";
import { Id, decodeWireSync } from "@starter/office-contract";
import { officeDenied } from "./office-private-authority.ts";
import { assertOfficeHostFrame } from "./office-host-auth.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { officePrivateResponse } from "./office-private-response.ts";
import type { OfficeHostRuntime } from "./office-host-state.ts";

const Assert = Schema.Struct({ frameId: Id });
const Placement = Schema.Struct({ documentId: Id });
/** Native same-DO Worker self capability. Callback-only Node binding CANNOT select this audience. */
export const officeHostMaintenance = (root: OfficeHostRuntime, request: Request) =>
  Effect.gen(function* () {
    if (root.closing || request.method !== "POST") return yield* Effect.fail(officeDenied());
    const boot = yield* Effect.tryPromise({ try: () => root.process.bootId, catch: officeDenied });
    yield* Effect.tryPromise({ try: () => root.process.peer(boot, false), catch: officeDenied });
    const path = new URL(request.url).pathname;
    const body = yield* Effect.tryPromise({
      try: () =>
        readOfficePrivateJson(request.body, request.signal, Date.now() + 10_000, 16 * 1024),
      catch: officeDenied,
    });
    let owner = root.bootIO;
    if (path === "/assert") {
      const input = decodeWireSync(Assert)(body);
      const entry = root.entries.get(input.frameId);
      if (entry === undefined) return yield* Effect.fail(officeDenied());
      yield* assertOfficeHostFrame(root, entry);
      owner = entry.frame.io;
    } else if (path === "/placement") {
      const input = decodeWireSync(Placement)(body);
      const active = yield* Effect.tryPromise({ try: () => root.active(), catch: officeDenied });
      yield* Effect.tryPromise({
        try: () => active.placements.renew(input.documentId),
        catch: officeDenied,
      });
    } else return yield* Effect.fail(officeDenied());
    return officePrivateResponse(
      null,
      16 * 1024,
      owner,
      request.signal,
      Date.now() + 10_000,
      false,
      async () => {
        await root.process.peer(boot, false);
      },
    );
  });
