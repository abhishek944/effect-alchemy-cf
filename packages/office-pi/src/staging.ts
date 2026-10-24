import { Cause, Effect, Exit, Schema } from "effect";
import { reportFailure } from "@starter/diagnostics";
import { officeStagingFailure } from "./staging-failure.ts";
import {
  ArtifactRef,
  Count,
  Digest,
  OFFICE_LIMITS,
  decodeWireSync,
} from "@starter/office-contract";
import type { OfficeCommand } from "@starter/office-contract";
import type { BinaryUpload } from "@starter/office-contract/client";
import { digestBytes } from "./intent.ts";
import type { OfficeTaskAccess } from "./types.ts";

const FileMetadata = Schema.Struct({
  filename: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
  bytes: Count.check(Schema.isLessThanOrEqualTo(OFFICE_LIMITS.uploadBytes)),
  digest: Digest,
});
type Stage = Extract<OfficeCommand, { command: "stage-code" | "stage-file" }>;

// Keep single domain instances and the complete Cause for mixed failures/interruption.
const runStage = async <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect, signal === undefined ? {} : { signal });
  if (Exit.isSuccess(exit)) return exit.value;
  const reason = exit.cause.reasons[0];
  if (exit.cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason))
    throw reason.error;
  throw exit.cause;
};
const upload = async (access: OfficeTaskAccess, input: BinaryUpload, signal?: AbortSignal) => {
  try {
    const ref = decodeWireSync(ArtifactRef)(await runStage(access.upload(input), signal));
    if (
      ref.id !== input.operationId ||
      ref.kind !== input.kind ||
      ref.bytes !== input.bytes ||
      ref.digest !== input.digest
    )
      throw new Error("Office staging acknowledgement mismatch");
    return ref;
  } catch (error) {
    signal?.throwIfAborted();
    throw officeStagingFailure(input.operationId, "upload-response", true, error);
  }
};

export const stage = async (command: Stage, access: OfficeTaskAccess, signal?: AbortSignal) => {
  const operationId = command.input.operationId;
  if (command.command === "stage-code") {
    const bytes = new TextEncoder().encode(command.input.source);
    const digest = await digestBytes(bytes).catch((error: unknown) => {
      signal?.throwIfAborted();
      throw officeStagingFailure(operationId, "stage-metadata", false, error);
    });
    signal?.throwIfAborted();
    return upload(
      access,
      {
        operationId,
        kind: "code",
        filename: "office.js",
        bytes: bytes.byteLength,
        digest,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
      },
      signal,
    );
  }
  const file = await runStage(access.acceptedFile(command.input.fileRef), signal).catch(
    (error: unknown) => {
      signal?.throwIfAborted();
      throw officeStagingFailure(operationId, "accepted-proof", false, error);
    },
  );
  // Own the source reader until the upload settles, including transport failure before first pull.
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = file.body.getReader();
  } catch (error) {
    signal?.throwIfAborted();
    throw officeStagingFailure(operationId, "accepted-storage", false, error);
  }
  try {
    let metadata: typeof FileMetadata.Type;
    try {
      metadata = decodeWireSync(FileMetadata)({
        filename: file.filename,
        bytes: file.bytes,
        digest: file.digest,
      });
    } catch (error) {
      throw officeStagingFailure(operationId, "stage-metadata", false, error);
    }
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) controller.close();
          else controller.enqueue(part.value);
        } catch (cause) {
          controller.error(cause);
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return await upload(access, { operationId, kind: "upload", ...metadata, body }, signal);
  } finally {
    await reader.cancel().catch((cause: unknown) => {
      reportFailure(cause, {
        component: "office.staging",
        operation: "cancel-reader",
        operationId,
        event: "application.cleanup",
      });
    });
    reader.releaseLock();
  }
};
