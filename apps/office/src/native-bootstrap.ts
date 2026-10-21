import { finished } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { Effect, Schema } from "effect";
import { OfficeForbidden, decodeWireSync, safeFailure } from "@starter/office-contract";
import { HostPolicy } from "@starter/office-server/native-remote";
import { OwnerClaims } from "@starter/office-server/ports";
import { makeIsolatedJobs } from "@starter/office-server/jobs";
import { makeNativeOfficeHost } from "./native-main.ts";
import { makeOfficeNodeServer } from "./native-server.ts";
import { OfficeRequestContext } from "./native-request-context.ts";
import { createOfficeMetadataClient } from "./native-metadata-client.ts";
import { createOfficeControlClient } from "./native-control-client.ts";
import { createOfficeDocumentAuthority } from "./native-document-authority.ts";
import { createNativeClient } from "./native-client.ts";
import { NativePrivateConnection } from "./native-private-connection.ts";
import { NativePrivateInvocations } from "./native-private-invocations.ts";
import { nativePrivateSocket } from "./native-private-sockets.ts";
import { nativePrivateFile } from "./native-private-files.ts";
import { nativePrivateAuthority } from "./native-private-authority.ts";
import { nativeJobPlacement } from "./native-job-placement.ts";

const required = (name: string) => {
  const value = process.env[name];
  if (value === undefined) throw new Error(`Missing Office bootstrap configuration: ${name}`);
  return value;
};
/** Actual fixed image entry. No model/generated execution, Docker, cookies or provider credentials here. */
export const nativeBootstrap = Effect.gen(function* () {
  const owner = decodeWireSync(OwnerClaims)({
    stage: required("OFFICE_STAGE"),
    ownerId: required("OFFICE_OWNER_ID"),
  });
  const policy = decodeWireSync(HostPolicy)(JSON.parse(required("OFFICE_POLICY")));
  const connection = new NativePrivateConnection(
    required("OFFICE_BOOT_ID"),
    required("OFFICE_STORAGE_ORIGIN"),
  );
  const context = new OfficeRequestContext();
  const invocations = new NativePrivateInvocations(connection, context);
  yield* Effect.addFinalizer(() => Effect.promise(() => invocations.drain()));
  const metadata = createOfficeMetadataClient(context.work);
  const controls = createOfficeControlClient(context.work);
  const native = createNativeClient({
    manifest: context.manifest,
    cleanup: context.cleanup,
    binary: context.binary,
    policy,
  });
  const dependencies = {
    ...native,
    metadata,
    policy,
    verifyActor: controls.verifyActor,
    observeNativeReceipt: controls.observeNativeReceipt,
    authority: createOfficeDocumentAuthority(context.work, context.cleanup),
    jobs: makeIsolatedJobs({
      metadata,
      bytes: native.bytes,
      placement: nativeJobPlacement(invocations, policy.imageDigest),
      policyVersion: policy.version,
      workerId: connection.bootId,
      jobSeconds: 60,
      maxActive: 1,
    }),
  };
  const host = yield* makeNativeOfficeHost({
    dependencies,
    context,
    owner,
    maxProtocols: 16,
    bindAuthority: nativePrivateAuthority(invocations, dependencies),
    resolve: async (request) => {
      const original = invocations.from(request);
      const { value, channels, signal } = original;
      const base = { channels, signal, invocationId: value.invocationId, deadline: value.deadline };
      if (value.kind === "core") return { ...base, kind: "core", actor: value.actor };
      if (value.view === null) throw new OfficeForbidden(safeFailure("FORBIDDEN"));
      return { ...base, kind: "protocol", viewId: value.view.view.id };
    },
  });
  let terminate: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    terminate = resolve;
  });
  const stop = () => {
    terminate?.();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      process.off("SIGTERM", stop);
      process.off("SIGINT", stop);
    }),
  );
  // SAME Scope, AFTER host: real listener closes FIRST; SDK/drain/provider callbacks remain alive.
  const listener = yield* makeOfficeNodeServer({
    host: "0.0.0.0",
    port: 8080,
    maxConnections: 128,
    maxRequests: 128,
    maxHeaderBytes: 16 * 1024,
    maxHeadersCount: 64,
    headersTimeoutMs: 10_000,
    requestTimeoutMs: 180_000,
    handlers: {
      request: async (request, response, signal) => {
        if (request.url === "/__office/shutdown" && request.method === "POST") {
          await connection.json(
            "/bootstrap/shutdown",
            {},
            Schema.Null,
            signal,
            Date.now() + 10_000,
          );
          const sent = finished(response, { cleanup: true });
          response.writeHead(204, { "cache-control": "private, no-store" }).end();
          await sent;
          stop();
          return;
        }
        await invocations.run(
          request,
          signal,
          () => {
            const { actor, file } = invocations.from(request).value;
            // The ORIGINAL private frame selected the fixed binary route; Node headers cannot choose it.
            return file === null
              ? host.handlers.request(request, response, signal)
              : nativePrivateFile({
                  office: host.office,
                  actor,
                  file,
                  request,
                  response,
                  signal,
                  // A rejected real reader close must make /finished report clean:false.
                  onCleanupFailure: () => invocations.context.failCleanup(),
                });
          },
          "http",
        );
      },
      upgrade: (request, socket, head, signal) =>
        invocations.run(
          request,
          signal,
          () => {
            nativePrivateSocket(invocations, invocations.from(request), socket);
            return host.handlers.upgrade(request, socket, head, signal);
          },
          "upgrade",
        ),
      revoke: () => host.handlers.revoke(),
      drain: async () => {
        await host.handlers.drain();
        await invocations.drain();
      },
    },
  });
  yield* Effect.tryPromise({
    try: () =>
      connection.json(
        "/bootstrap/ready",
        {
          bootId: connection.bootId,
          processId: process.pid,
          address: { address: listener.address.address, port: listener.address.port },
        },
        Schema.Null,
        listener.signal,
        Date.now() + 30_000,
      ),
    catch: () => new OfficeForbidden(safeFailure("FORBIDDEN")),
  });
  yield* Effect.promise(() => stopped);
  return connection; // Caller observes completion ONLY AFTER the surrounding Scope joins listener/host/IO.
});

if (process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const connection = await Effect.runPromise(Effect.scoped(nativeBootstrap));
  await connection.json(
    "/bootstrap/stopped",
    {},
    Schema.Null,
    new AbortController().signal,
    Date.now() + 10_000,
  );
}
