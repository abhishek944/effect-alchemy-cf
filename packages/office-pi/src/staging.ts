import { Effect, Schema } from "effect";
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

const upload = async (access: OfficeTaskAccess, input: BinaryUpload, signal?: AbortSignal) => {
  const ref = decodeWireSync(ArtifactRef)(
    await Effect.runPromise(access.upload(input), signal === undefined ? {} : { signal }),
  );
  if (ref.kind !== input.kind || ref.bytes !== input.bytes || ref.digest !== input.digest)
    throw new Error("Office staging acknowledgement mismatch");
  return ref;
};

export const stage = async (command: Stage, access: OfficeTaskAccess, signal?: AbortSignal) => {
  const operationId = command.input.operationId;
  if (command.command === "stage-code") {
    const bytes = new TextEncoder().encode(command.input.source);
    const digest = await digestBytes(bytes);
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
  const file = await Effect.runPromise(
    access.acceptedFile(command.input.fileRef),
    signal === undefined ? {} : { signal },
  );
  // Own the source reader until the upload settles, including transport failure before first pull.
  const reader = file.body.getReader();
  try {
    const metadata = decodeWireSync(FileMetadata)({
      filename: file.filename,
      bytes: file.bytes,
      digest: file.digest,
    });
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const part = await reader.read();
          if (part.done) controller.close();
          else controller.enqueue(part.value);
        } catch {
          controller.error(new Error("Accepted file read failed"));
        }
      },
      cancel: (reason) => reader.cancel(reason),
    });
    return await upload(access, { operationId, kind: "upload", ...metadata, body }, signal);
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
};
