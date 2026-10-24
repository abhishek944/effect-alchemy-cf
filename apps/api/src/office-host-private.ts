import { Effect, Schema } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import {
  NativePrivateFinished,
  NativePrivateMember,
  NativePrivateResolution,
} from "../../office/src/native-private-wire.ts";
import { officeCaught, officeDenied } from "./office-private-authority.ts";
import { officeHostCleanup, assertOfficeHostFrame } from "./office-host-auth.ts";
import { officePrivateControl } from "./office-private-control.ts";
import { officeHostBinary } from "./office-host-binary.ts";
import { officePrivateResponse } from "./office-private-response.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import { officePrivateStream } from "./office-private-stream.ts";
import { officeHostUnit } from "./office-host-unit.ts";
import type { OfficeHostRuntime } from "./office-host-state.ts";

const Status = Schema.Struct({ cancel: Schema.Boolean });
const Empty = Schema.Struct({});
export const officeHostPrivate = (root: OfficeHostRuntime, request: Request) =>
  Effect.gen(function* () {
    const url = new URL(request.url);
    const parts = /^\/private\/([A-Za-z0-9_-]{1,256})\/([a-z-]+)$/.exec(url.pathname);
    if (
      request.method !== "POST" ||
      parts === null ||
      parts[1] === undefined ||
      parts[2] === undefined
    )
      return yield* Effect.fail(officeDenied());
    const id = parts[1],
      role = parts[2],
      boot = request.headers.get("x-office-boot");
    const cleanup = ["cleanup", "closed", "finished", "socket-closed", "job-status"].includes(role);
    // ORIGINAL native loopback audience + actual physical pinned process BEFORE selecting any record.
    yield* Effect.tryPromise({ try: () => root.process.peer(boot, cleanup), catch: officeCaught });
    const entry = root.entries.get(id);
    if (entry === undefined || entry.canonical) return yield* Effect.fail(officeDenied());
    if (cleanup) yield* Effect.try({ try: () => officeHostCleanup(entry), catch: officeCaught });
    else yield* assertOfficeHostFrame(root, entry);
    const frame = entry.frame;
    const signal = cleanup ? frame.cleanup.signal : frame.work.signal;
    const deadline = cleanup ? frame.cleanupDeadline : entry.resolution.deadline;
    const peer = async () => {
      await root.process.peer(boot, true);
    };
    const json = (value: unknown) =>
      officePrivateResponse(
        value,
        16 * 1024,
        frame.io,
        signal,
        deadline,
        cleanup,
        peer,
        200,
        frame.request.charge,
      );
    return yield* Effect.tryPromise({
      catch: officeCaught,
      try: () =>
        frame.io.track(async () => {
          if (["control", "manifest", "cleanup"].includes(role)) {
            const selected =
              role === "manifest" ? "manifest" : role === "cleanup" ? "cleanup" : "control";
            return officePrivateControl(request.body, frame, entry.backend, selected, peer);
          }
          if (role === "binary") {
            return officeHostBinary(root, entry, request.body);
          }
          if (role === "job-run") {
            if (request.body === null) throw officeDenied();
            const input = officePrivateStream(
              request.body,
              root.policy.limits.nativeBytes + root.policy.limits.codeBytes + 16 * 1024,
              frame.work.signal,
              entry.resolution.deadline,
              peer,
              () => frame.revoke(),
            );
            frame.io.hold(input, false);
            const body = await entry.backend.jobs.run(input.body);
            const resource = officePrivateStream(
              body,
              root.policy.limits.nativeBytes,
              frame.work.signal,
              entry.resolution.deadline,
              () => entry.backend.jobs.close(),
              () => frame.revoke(),
            );
            frame.io.hold(resource, false);
            return new Response(resource.body, {
              headers: { "content-type": "application/octet-stream" },
            });
          }
          const body = await readOfficePrivateJson(
            request.body,
            signal,
            deadline,
            16 * 1024,
            frame.request.charge,
          );
          if (role === "resolve") {
            decodeWireSync(Empty)(body);
            const active = await root.active();
            const unit = await officeHostUnit(active, entry, request);
            return json(decodeWireSync(NativePrivateResolution)({ ...entry.resolution, unit }));
          }
          if (role === "member-check") {
            if (entry.backend.channel === null) throw officeDenied();
            await entry.backend.channel.checkMember(decodeWireSync(NativePrivateMember)(body));
            return json(null);
          }
          if (role === "job-status")
            return json(await entry.backend.jobs.status(decodeWireSync(Status)(body).cancel));
          decodeWireSync(role === "finished" ? NativePrivateFinished : Empty)(body);
          if (role === "finished") {
            const value = decodeWireSync(NativePrivateFinished)(body);
            frame.reportFinished(value.kind, value.clean);
          } else if (role === "socket-closed") frame.reportSocketClosed();
          else if (role === "closed") {
            await entry.backend.channel?.close(frame.id);
            frame.reportSDKClosed();
          } else throw officeDenied();
          return json(null);
        }),
    });
  });

export const officeHostBootstrap = (root: OfficeHostRuntime, request: Request) =>
  Effect.gen(function* () {
    const path = new URL(request.url).pathname;
    const boot = request.headers.get("x-office-boot");
    if (
      request.method !== "POST" ||
      !["/bootstrap/ready", "/bootstrap/shutdown", "/bootstrap/stopped"].includes(path)
    )
      return yield* Effect.fail(officeDenied());
    yield* Effect.tryPromise({
      try: () => root.process.peer(boot, path !== "/bootstrap/ready"),
      catch: officeCaught,
    });
    return yield* Effect.tryPromise({
      catch: officeCaught,
      try: () =>
        root.bootIO.track(async () => {
          const payload = await readOfficePrivateJson(
            request.body,
            request.signal,
            Date.now() + 10_000,
            16 * 1024,
          );
          if (path === "/bootstrap/ready") await root.process.ready(boot, payload);
          else {
            decodeWireSync(Empty)(payload);
            if (path === "/bootstrap/shutdown" && !root.closing) throw officeDenied();
            if (path === "/bootstrap/stopped") root.markStopped();
          }
          return officePrivateResponse(
            null,
            16 * 1024,
            root.bootIO,
            request.signal,
            Date.now() + 10_000,
            path !== "/bootstrap/ready",
            async () => {
              await root.process.peer(boot, true);
            },
          );
        }),
    });
  });
