import { Effect } from "effect";
import { decodeWireSync } from "@starter/office-contract";
import { HostBytes, HostPolicy } from "@starter/office-server/native-remote";
import type { OfficeBytes, OfficeDependencies } from "@starter/office-server/ports";
import type { OfficeBinarySession } from "./native-transfer-types.ts";
import type { OfficeControlSession } from "./native-channel.ts";
import { adapterFailure, emptyBody, invalidBytes, watchBytes } from "./native-stream-io.ts";

/** T47 supplies request-local borrowed sessions; IDs/refs are not authority. */
export function createNativeBytesClient(
  binary: OfficeBinarySession,
  manifest: OfficeControlSession,
  configuration: OfficeDependencies["policy"],
): OfficeBytes {
  const policy = decodeWireSync(HostPolicy)(structuredClone(configuration));
  const maximum = (kind: Parameters<OfficeBytes["put"]>[1]["kind"]) =>
    kind === "upload"
      ? policy.limits.uploadBytes
      : kind === "code"
        ? policy.limits.codeBytes
        : kind === "native-proposal"
          ? policy.limits.proposalBytes
          : kind === "render"
            ? policy.limits.renderBytes
            : kind === "inspection"
              ? policy.limits.responseBytes
              : policy.limits.nativeBytes;
  const responseLimit = Math.max(
    policy.limits.uploadBytes,
    policy.limits.codeBytes,
    policy.limits.proposalBytes,
    policy.limits.renderBytes,
    policy.limits.responseBytes,
    policy.limits.nativeBytes,
  );
  return {
    put: (owner, input) =>
      Effect.gen(function* () {
        const header = yield* Effect.try({
          try: () =>
            decodeWireSync(HostBytes.put.request)(
              structuredClone({
                method: HostBytes.put.method,
                input: {
                  owner,
                  id: input.id,
                  kind: input.kind,
                  mediaType: input.mediaType,
                  declaredBytes: input.declaredBytes,
                  expectedDigest: input.expectedDigest,
                },
              }),
            ).input,
          catch: adapterFailure,
        });
        return yield* Effect.acquireUseRelease(
          Effect.try({
            try: () =>
              watchBytes(
                input.body,
                header.declaredBytes,
                maximum(header.kind),
                header.expectedDigest,
              ),
            catch: adapterFailure,
          }),
          (watched) =>
            Effect.acquireUseRelease(
              binary.exchange(HostBytes.put, header, {
                body: watched.body,
                requestBytes: header.declaredBytes,
                responseLimit: 0,
                mutation: true,
              }),
              (response) =>
                Effect.gen(function* () {
                  const summary = yield* Effect.tryPromise({
                    try: () => watched.done,
                    catch: adapterFailure,
                  });
                  yield* Effect.tryPromise({
                    try: () => emptyBody(response.body),
                    catch: adapterFailure,
                  });
                  const ref = response.value;
                  if (
                    ref.id !== header.id ||
                    ref.kind !== header.kind ||
                    ref.mediaType !== header.mediaType ||
                    ref.bytes !== summary.bytes ||
                    ref.digest !== summary.digest
                  )
                    return yield* Effect.fail(invalidBytes());
                  return Object.freeze({ ...ref });
                }),
              (response) => Effect.promise(() => response.body.cancel()),
            ),
          (watched) => Effect.promise(() => watched.cancel(invalidBytes())),
        );
      }),
    get: (owner, id) =>
      Effect.gen(function* () {
        const header = yield* Effect.try({
          try: () =>
            decodeWireSync(HostBytes.get.request)(
              structuredClone({ method: HostBytes.get.method, input: { owner, id } }),
            ).input,
          catch: adapterFailure,
        });
        const response = yield* binary.exchange(HostBytes.get, header, {
          body: null,
          requestBytes: 0,
          responseLimit,
          mutation: false,
        });
        const ref = response.value;
        if (ref === null) {
          yield* Effect.tryPromise({ try: () => emptyBody(response.body), catch: adapterFailure });
          return null;
        }
        if (ref.id !== header.id || ref.bytes > maximum(ref.kind)) {
          yield* Effect.promise(() => response.body.cancel());
          return yield* Effect.fail(invalidBytes());
        }
        const watched = yield* Effect.try({
          try: () => watchBytes(response.body, ref.bytes, maximum(ref.kind), ref.digest),
          catch: adapterFailure,
        });
        return { ref: Object.freeze({ ...ref }), body: watched.body };
      }),
    removeUnreachable: (owner, id, notBefore) =>
      manifest
        .call(HostBytes.removeUnreachable, { owner, id, notBefore }, true)
        .pipe(Effect.asVoid),
  };
}
