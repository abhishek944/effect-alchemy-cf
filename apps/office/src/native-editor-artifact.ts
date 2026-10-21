import { createHash } from "node:crypto";
import { Effect } from "effect";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import { encodeNativeFrame } from "@starter/office-contract/native-wire";
import type { OfficeBytes, OwnerScope } from "@starter/office-server/ports";

/** Native values stay in an immutable binary artifact, never the control/receipt JSON. */
export const stageEditorArtifact = Effect.fn("Office.stageEditorArtifact")(function* (
  store: OfficeBytes,
  owner: OwnerScope,
  id: string,
  value: unknown,
  maximum: number,
) {
  const bytes = encodeNativeFrame("proposal", value);
  if (bytes.byteLength > Math.min(maximum, 128 * 1024 * 1024))
    return yield* Effect.fail(new OfficeUnavailable(safeFailure("LIMIT_EXCEEDED")));
  const digest = createHash("sha256").update(bytes).digest("hex");
  const mediaType = "application/vnd.office-native.msgpack";
  const ref = yield* store.put(owner, {
    id,
    kind: "native-write",
    mediaType,
    declaredBytes: bytes.byteLength,
    expectedDigest: digest,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  });
  if (
    ref.id !== id ||
    ref.kind !== "native-write" ||
    ref.digest !== digest ||
    ref.bytes !== bytes.byteLength ||
    ref.mediaType !== mediaType
  )
    return yield* Effect.fail(new OfficeUnavailable(safeFailure("OUTCOME_UNKNOWN")));
  return ref;
});
