import { Effect } from "effect";
import { ArtifactRef, decodeWireSync } from "@starter/office-contract";
import { officeStagingFailure, type OfficeStagingPhase } from "@starter/office-pi";
import type { BinaryUpload } from "@starter/office-contract/client";
import { officeBinaryUpload } from "../../office/src/native-transfer-upload.ts";
import { assertOfficeTaskUpload } from "./office-task-command.ts";
import { officeDenied } from "./office-private-authority.ts";
import { readOfficePrivateJson } from "./office-private-json.ts";
import type { ChatOfficeTaskBroker, OfficeTaskLease } from "./chat-office-task-broker.ts";
import type { OfficeTaskTransport } from "./chat-office-transport.ts";

/** Actual provider ACK, counted local EOF, physical local closure, THEN native durable provenance. */
export function officeTaskUpload(
  transport: OfficeTaskTransport,
  broker: ChatOfficeTaskBroker,
  lease: OfficeTaskLease,
  parent: AbortSignal | undefined,
  input: BinaryUpload,
) {
  let phase: OfficeStagingPhase = "upload-validation";
  let submitted = false;
  return Effect.tryPromise({
    try: async () => {
      const stop = new AbortController();
      const signal = parent === undefined ? stop.signal : AbortSignal.any([parent, stop.signal]);
      const source = officeBinaryUpload(
        new Uint8Array(0),
        input.body,
        input.bytes,
        signal,
        lease.notAfter,
        () => undefined,
      );
      const timer = setTimeout(() => stop.abort(), Math.max(0, lease.notAfter - Date.now()));
      const abort = () => {
        // Observe now; finally joins THIS same first cancellation promise and preserves failure.
        void source.cancel().catch(() => undefined);
      };
      signal.addEventListener("abort", abort, { once: true });
      try {
        let result: { value: typeof ArtifactRef.Type } | { error: unknown };
        try {
          signal.throwIfAborted();
          const upload = {
            operationId: input.operationId,
            kind: input.kind,
            filename: input.filename,
            bytes: input.bytes,
            digest: input.digest ?? null,
          };
          assertOfficeTaskUpload(transport.proof, upload);
          // ASCII JSON header preserves real Unicode filenames without invalid ByteString headers.
          const header = JSON.stringify(upload).replace(/[^\u0020-\u007e]/gu, (character) =>
            character
              .split("")
              .map((unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`)
              .join(""),
          );
          phase = "upload-transport";
          const value = await transport.request(
            "upload",
            {
              headers: { "content-type": "application/octet-stream", "x-office-upload": header },
              body: source.stream,
            },
            false,
            async (response, responseSignal, deadline) => {
              phase = "upload-response";
              if (response.status !== 200) throw officeDenied();
              const ref = decodeWireSync(ArtifactRef)(
                await readOfficePrivateJson(response.body, responseSignal, deadline, 16 * 1024),
              );
              if (
                ref.id !== input.operationId ||
                ref.kind !== input.kind ||
                ref.bytes !== input.bytes ||
                ref.digest !== input.digest
              )
                throw officeDenied();
              await source.complete();
              signal.throwIfAborted();
              return ref;
            },
            () => {
              submitted = true;
            },
          );
          result = { value };
        } catch (error) {
          result = { error };
        }
        const failedPhase = phase;
        try {
          phase = "upload-cleanup";
          await source.cancel();
        } catch (error) {
          throw new AggregateError(
            "error" in result ? [result.error, error] : [error],
            "Office staging cleanup failed",
            { cause: error },
          );
        }
        if ("error" in result) {
          phase = failedPhase;
          throw result.error;
        }
        signal.throwIfAborted();
        phase = "upload-acknowledgement";
        await broker.acknowledge(lease, result.value);
        signal.throwIfAborted();
        if (Date.now() >= lease.notAfter) throw officeDenied();
        return result.value;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      }
    },
    catch: (error) => officeStagingFailure(input.operationId, phase, submitted, error),
  }).pipe(Effect.uninterruptible);
}
