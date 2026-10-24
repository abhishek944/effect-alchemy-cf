import { Effect, Schema } from "effect";
import { withCause } from "@starter/diagnostics";
import { officeReportBranch } from "./office-diagnostic-report.ts";
import { officeCaught } from "./office-failure.ts";
import {
  Count,
  Digest,
  Id,
  OfficeUnavailable,
  decodeWireSync,
  safeFailure,
} from "@starter/office-contract";
import { HostOfficeRequest } from "@starter/office-server/native-remote";
import { officeHostOriginal } from "./office-host-auth.ts";
import { officeHostProtocol } from "./office-host-protocol.ts";
import { officeDenied } from "./office-private-authority.ts";
import { officeHostEntry } from "./office-host-entry.ts";
import { createOfficeHostChannel } from "./office-host-channel.ts";
import { forwardOfficeHost } from "./office-host-forward.ts";
import { officeHostArtifact } from "./office-host-artifact.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import type { OfficeHostRuntime } from "./office-host-state.ts";
import type { OfficeInvocation } from "./office-invocations.ts";
import { assertOfficeTaskRoute, assertOfficeTaskBody } from "./office-task-ingress.ts";
import { officeHostSources } from "./office-host-sources.ts";

const Channel = Schema.Struct({ viewId: Id, editorId: Schema.NullOr(Id) });
const Upload = Schema.Struct({
  operationId: Id,
  kind: Schema.Literals(["upload", "code"]),
  filename: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)),
  bytes: Count,
  digest: Schema.NullOr(Digest),
});
const uncertain = (cause?: unknown) =>
  withCause(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")), cause);
const diagnosed = (cause: unknown, reason: string, callId?: string, mode = "ingress") =>
  officeReportBranch(officeCaught(cause), {
    component: "office.host-api",
    operation: "request",
    phase: mode,
    reason,
    callId,
  });
/** ONLY actual authenticated Worker private namespace can reach this audience, never Node callbacks. */
export const officeHostApi = (root: OfficeHostRuntime, request: Request) => {
  let registered: OfficeInvocation | undefined;
  let handed = false;
  return Effect.gen(function* () {
    const url = new URL(request.url);
    const match = /^\/(core|channel|upload|download|artifact|protocol|sources)\/([^/]+)(.*)$/.exec(
      url.pathname,
    );
    if (root.closing || match === null || match[1] === undefined || match[2] === undefined)
      return yield* Effect.fail(
        diagnosed(officeDenied(), root.closing ? "api-closing" : "api-route-invalid"),
      );
    const mode = match[1],
      id = decodeWireSync(Id)(match[2]),
      suffix = match[3] ?? "";
    // Actual same-script API association precedes this synchronous ownership claim.
    try {
      registered = root.registry.claim(id);
    } catch (cause) {
      throw diagnosed(cause, "registry-claim", id, mode);
    }
    const original = yield* officeHostOriginal(root, id).pipe(
      Effect.mapError((cause) => diagnosed(cause, "registry-resolve", id, mode)),
    );
    if (original !== registered)
      return yield* Effect.fail(diagnosed(officeDenied(), "invocation-mismatch", id, mode));
    if ("purpose" in original && (original.purpose === "channel") !== (mode === "channel"))
      return yield* Effect.fail(diagnosed(officeDenied(), "invocation-purpose", id, mode));
    yield* Effect.try({
      try: () => assertOfficeTaskRoute(original, mode),
      catch: (cause) => diagnosed(cause, "task-route", id, mode),
    });
    for (const [key, until] of root.consumed) if (until <= Date.now()) root.consumed.delete(key);
    if (root.consumed.has(id) || root.consumed.size >= 4096)
      return yield* Effect.fail(
        diagnosed(
          officeDenied(),
          root.consumed.has(id) ? "invocation-reused" : "invocation-capacity",
          id,
          mode,
        ),
      );
    root.consumed.set(id, original.deadline); // One actual original forward, never admission-ACK replay.
    const active = yield* Effect.tryPromise({ try: () => root.active(), catch: uncertain });
    if (mode === "protocol")
      return yield* officeHostProtocol(root, active, original, request, suffix);
    if (mode === "sources") {
      if (suffix !== "")
        return yield* Effect.fail(diagnosed(officeDenied(), "sources-suffix", id, mode));
      return yield* officeHostSources(root, active, original, request);
      // No handed frame: finally releases the Human registration after actual IO joins.
    }
    if (request.method !== "POST" || (!["download", "artifact"].includes(mode) && suffix !== ""))
      return yield* Effect.fail(diagnosed(officeDenied(), "api-method", id, mode));
    if (mode === "channel") {
      const input = decodeWireSync(Channel)(
        yield* Effect.tryPromise({
          try: () =>
            readOfficePrivateJson(request.body, request.signal, original.deadline, 16 * 1024),
          catch: uncertain,
        }),
      );
      const value = yield* Effect.tryPromise({
        try: () => createOfficeHostChannel(root, active, original, input.viewId, input.editorId),
        catch: (cause) => diagnosed(uncertain(cause), "channel-create", id, mode),
      });
      handed = true;
      return Response.json(value);
    }
    if (mode === "artifact") {
      const artifactId = decodeWireSync(Id)(suffix.slice(1));
      const value = yield* Effect.tryPromise({
        try: () => officeHostArtifact(active, original, artifactId),
        catch: uncertain,
      });
      const fresh = yield* officeHostOriginal(root, original.actor.invocationId);
      if (fresh !== original) return yield* Effect.fail(officeDenied());
      return Response.json(value);
    }
    let command: typeof HostOfficeRequest.Type | null = null;
    let file: Parameters<typeof officeHostEntry>[3]["file"] = null;
    let body: string | ReadableStream<Uint8Array> | null = request.body;
    let path = "/__office/core";
    if (mode === "core") {
      command = decodeWireSync(HostOfficeRequest)(
        yield* Effect.tryPromise({
          try: () =>
            readOfficePrivateJson(request.body, request.signal, original.deadline, 16 * 1024),
          catch: uncertain,
        }),
      );
    } else if (mode === "upload") {
      const metadata = request.headers.get("x-office-upload");
      if (metadata === null || metadata.length > 4096) return yield* Effect.fail(officeDenied());
      file = { kind: "upload", input: decodeWireSync(Schema.fromJsonString(Upload))(metadata) };
      path = "/__office/upload";
    } else if (mode === "download") {
      file = { kind: "download", artifactId: decodeWireSync(Id)(suffix.slice(1)) };
      path = "/__office/download";
      body = null;
    }
    yield* Effect.try({
      try: () => assertOfficeTaskBody(original, command, file),
      catch: (cause) => diagnosed(cause, "task-body", id, mode),
    });
    let entry: ReturnType<typeof officeHostEntry>;
    try {
      entry = officeHostEntry(root, active, original, {
        command,
        view: null,
        binding: null,
        channelId: null,
        canonical: false,
        kind: "http",
        deadline: original.deadline,
        access: null,
        file,
      });
    } catch (cause) {
      throw diagnosed(cause, "entry-create", id, mode);
    }
    handed = true;
    const callId = command === null ? null : crypto.randomUUID();
    if (command !== null)
      body = JSON.stringify({ version: 1, invocationId: entry.frame.id, callId, payload: command });
    return yield* Effect.tryPromise({
      try: () =>
        forwardOfficeHost(
          root,
          entry,
          request,
          path,
          body,
          mode === "download" ? root.policy.limits.nativeBytes : 16 * 1024,
          false,
          callId,
        ),
      catch: uncertain,
    });
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        if (
          !handed &&
          registered !== undefined &&
          ![...root.entries.values()].some((entry) => entry.frame.original === registered)
        )
          root.registry.release(registered);
      }),
    ),
    // Cancellation still revokes through actual request/frame signals; retain this handoff owner
    // until its real foreign work settles or responsibility has synchronously moved to a frame.
    Effect.uninterruptible,
  );
};
