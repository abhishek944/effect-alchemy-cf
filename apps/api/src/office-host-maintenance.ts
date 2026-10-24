import { Effect, Schema } from "effect";
import { Id, decodeWireSync } from "@starter/office-contract";
import { officeCaught } from "./office-private-authority.ts";
import { officeDeny } from "./office-diagnostic-report.ts";
import { assertOfficeHostFrame } from "./office-host-auth.ts";
import { closeOfficeHostChannel } from "./office-host-channel.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { officePrivateResponse } from "./office-private-response.ts";
import type { OfficeHostRuntime } from "./office-host-state.ts";

const deny = (reason: string) =>
  officeDeny({ component: "office.maintenance", operation: "maintenance", reason });
const Assert = Schema.Struct({ frameId: Id });
const Placement = Schema.Struct({ documentId: Id });
/** Native same-DO Worker self capability. Callback-only Node binding CANNOT select this audience. */
export const officeHostMaintenance = (root: OfficeHostRuntime, request: Request) =>
  Effect.gen(function* () {
    if (root.closing) return yield* Effect.fail(deny("host-closing"));
    if (request.method !== "POST") return yield* Effect.fail(deny("method-invalid"));
    const boot = yield* Effect.tryPromise({ try: () => root.process.bootId, catch: officeCaught });
    yield* Effect.tryPromise({ try: () => root.process.peer(boot, false), catch: officeCaught });
    const path = new URL(request.url).pathname;
    const body = yield* Effect.tryPromise({
      try: () =>
        readOfficePrivateJson(request.body, request.signal, Date.now() + 10_000, 16 * 1024),
      catch: officeCaught,
    });
    let owner = root.bootIO;
    if (path === "/assert") {
      const input = decodeWireSync(Assert)(body);
      const entry = root.entries.get(input.frameId);
      if (entry === undefined) return yield* Effect.fail(deny("frame-missing"));
      yield* assertOfficeHostFrame(root, entry);
      owner = entry.frame.io;
    } else if (path === "/channel") {
      const input = decodeWireSync(Assert)(body);
      const channel = root.channels.get(input.frameId);
      if (channel !== undefined) {
        yield* assertOfficeHostFrame(root, channel.entry).pipe(
          Effect.catch(() => Effect.promise(() => closeOfficeHostChannel(root, channel))),
        );
        yield* Effect.tryPromise({ try: () => channel.maintain(), catch: officeCaught });
      }
    } else if (path === "/placement") {
      const input = decodeWireSync(Placement)(body);
      const active = yield* Effect.tryPromise({ try: () => root.active(), catch: officeCaught });
      yield* Effect.tryPromise({
        try: () => active.placements.renew(input.documentId),
        catch: officeCaught,
      });
    } else return yield* Effect.fail(deny("route-invalid"));
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
