import { Effect } from "effect";
import { Id, OfficeUnavailable, decodeWireSync, safeFailure } from "@starter/office-contract";
import { classifyNativeRoute } from "../../../packages/office-server/src/protocol/routes.ts";
import type { OfficeInvocation } from "./office-invocations.ts";
import type { OfficeHostActive, OfficeHostRuntime } from "./office-host-state.ts";
import { assertOfficeHostFrame } from "./office-host-auth.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeHostEntry } from "./office-host-entry.ts";
import { forwardOfficeHost } from "./office-host-forward.ts";

/** Current private registration proves the incoming session; canonical authority stays immutable. */
export const officeHostProtocol = (
  root: OfficeHostRuntime,
  active: OfficeHostActive,
  original: OfficeInvocation,
  request: Request,
  suffix: string,
) =>
  Effect.gen(function* () {
    const selected = /^\/([^/]+)(\/.*)$/.exec(suffix);
    if (selected?.[1] === undefined || selected[2] === undefined)
      return yield* Effect.fail(officeDenied());
    const channel = root.channels.get(decodeWireSync(Id)(selected[1]));
    if (channel === undefined || channel.expiresAt <= Date.now())
      return yield* Effect.fail(officeDenied());
    const previous = channel.entry.frame.original.session;
    if (
      previous.sessionId !== original.session.sessionId ||
      previous.sessionEpoch !== original.session.sessionEpoch ||
      previous.ownerId !== original.session.ownerId ||
      previous.stage !== original.session.stage
    )
      return yield* Effect.fail(officeDenied());
    yield* assertOfficeHostFrame(root, channel.entry);
    const kind = request.headers.get("upgrade")?.toLowerCase() === "websocket" ? "upgrade" : "http";
    const path = selected[2] + new URL(request.url).search;
    const route = classifyNativeRoute(kind === "upgrade" ? "UPGRADE" : request.method, path);
    const view = channel.entry.resolution.view;
    if (
      route === null ||
      view === null ||
      (route.params.viewID !== undefined && route.params.viewID !== view.view.id) ||
      (route.params.unitID !== undefined && route.params.unitID !== view.target.unitId) ||
      (route.params.worktreeID !== undefined &&
        (view.source.kind !== "draft" || route.params.worktreeID !== view.source.worktreeId))
    )
      return yield* Effect.fail(officeDenied());
    const access =
      route.params.viewID !== undefined
        ? null
        : {
            kind: "read" as const,
            target: view.target,
            authorityEpoch: view.authorityEpoch,
            serviceEpoch: view.serviceEpoch,
          };
    const entry = officeHostEntry(root, active, channel.entry.frame.original, {
      command: null,
      view,
      binding: channel.binding,
      channelId: channel.entry.frame.id,
      canonical: false,
      kind,
      deadline: channel.expiresAt,
      access,
      file: null,
    });
    channel.frames.add(entry);
    return yield* Effect.tryPromise({
      try: () =>
        forwardOfficeHost(
          root,
          entry,
          request,
          path,
          request.body,
          root.policy.limits.nativeBytes,
          true,
        ),
      catch: () => new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")),
    });
  });
