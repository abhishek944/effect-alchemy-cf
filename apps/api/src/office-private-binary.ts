import { Effect, Schema } from "effect";
import { decodeWireSync, type OfficeLimits } from "@starter/office-contract";
import { HostBytes, HostNativePieces, hostEnvelope } from "@starter/office-server/native-remote";
import type { OfficeMetadata } from "@starter/office-server/ports";
import type { OfficePrivateBackend } from "./office-private-backend.ts";
import { officeDenied, officeSame, type OfficePrivateRequest } from "./office-private-authority.ts";
import { officeBinaryInput } from "./office-private-binary-input.ts";
import { officeBinaryOutput } from "./office-private-binary-output.ts";
import { officeNativePart } from "./office-native-parts.ts";
import { holdOfficeNativeIO } from "./office-native-handle.ts";
import { assertOfficeTaskUploadPut } from "./office-task-ingress.ts";

const Envelope = Schema.Union([
  hostEnvelope(HostBytes.put.request),
  hostEnvelope(HostBytes.get.request),
  hostEnvelope(HostNativePieces.stage.request),
  hostEnvelope(HostNativePieces.read.request),
]);
/** Exact finite streamed methods. No body-to-JSON/native-byte repacking, SQL, arbitrary keys or retry. */
export async function officePrivateBinary(
  body: ReadableStream<Uint8Array> | null,
  request: OfficePrivateRequest,
  backend: OfficePrivateBackend,
  metadata: OfficeMetadata,
  limits: OfficeLimits,
) {
  await request.live();
  const input = officeBinaryInput(body, request);
  try {
    const envelope = decodeWireSync(Envelope)(await input.header());
    if (envelope.invocationId !== request.id) throw officeDenied();
    request.receive(envelope.callId);
    const call = envelope.payload;
    const reply = (
      value: () => unknown,
      payload: ReadableStream<Uint8Array> | null,
      bytes: number,
      guard: () => Promise<void> = request.live,
    ) =>
      officeBinaryOutput(
        request,
        () => ({
          version: 1,
          invocationId: request.id,
          callId: envelope.callId,
          payload: value(),
        }),
        payload,
        bytes,
        input.close,
        guard,
      );
    if (call.method === "bytes.put") {
      if (!officeSame(call.input.owner, request.original.actor.owner)) throw officeDenied();
      if (
        request.viewId !== null &&
        (call.input.kind !== "native-write" ||
          backend.channel === null ||
          (await backend.channel.require()) === null)
      )
        throw officeDenied();
      const kind = call.input.kind;
      if (
        "task" in request.original &&
        (request.file !== null || kind === "upload" || kind === "code")
      )
        assertOfficeTaskUploadPut(request, call.input);
      const maximum =
        kind === "code"
          ? limits.codeBytes
          : kind === "upload"
            ? limits.uploadBytes
            : kind === "native-proposal"
              ? limits.proposalBytes
              : kind === "render"
                ? limits.renderBytes
                : kind === "export"
                  ? 10 * 1024 * 1024
                  : kind === "inspection"
                    ? limits.responseBytes
                    : limits.nativeBytes;
      if (call.input.declaredBytes > maximum) throw officeDenied();
      // REAL provider hashes/counts the complete opaque source before returning any immutable ref ACK.
      const value = await Effect.runPromise(
        backend.bytes.put(call.input.owner, {
          ...call.input,
          body: input.stream(call.input.declaredBytes),
        }),
      );
      await request.live();
      return reply(
        () => decodeWireSync(HostBytes.put.response)({ method: call.method, value }),
        null,
        0,
      ).response;
    }
    if (call.method === "native.piece-stage") {
      return backend.handles.use(call.input.handleId, async (handle) => {
        if (handle.writer === null) throw officeDenied();
        const bytes = await input.buffer(4 * 1024 * 1024);
        await request.live();
        const value = await handle.writer.writer.references.payloads.stagePiece(bytes); // Actual byte hash/count before ACK.
        await request.live();
        const result = reply(
          () => decodeWireSync(HostNativePieces.stage.response)({ method: call.method, value }),
          null,
          0,
        );
        holdOfficeNativeIO(handle, result.resource);
        return result.response;
      });
    }
    await input.empty();
    if (call.method === "bytes.get") {
      if ("task" in request.original && request.file !== null) throw officeDenied();
      const owner = request.original.actor.owner;
      if (!officeSame(call.input.owner, owner)) throw officeDenied();
      if (request.viewId !== null) {
        const view = await Effect.runPromise(metadata.view(owner, request.viewId));
        if (
          view === null ||
          view.source.kind !== "artifact" ||
          view.source.artifact.id !== call.input.id
        )
          throw officeDenied();
      }
      const value = await Effect.runPromise(backend.bytes.get(owner, call.input.id));
      // Register any acquired real R2 reader inside reply BEFORE subsequent validation/response transfer.
      return reply(
        () =>
          decodeWireSync(HostBytes.get.response)({
            method: call.method,
            value: value?.ref ?? null,
          }),
        value?.body ?? null,
        value?.ref.bytes ?? 0,
      ).response;
    }
    return backend.handles.use(call.input.handleId, async (handle) => {
      const guard = async () => {
        if (!handle.active || handle.deadline <= Date.now()) throw officeDenied();
        await request.live();
        if (!handle.active || handle.deadline <= Date.now()) throw officeDenied();
      };
      const part = await officeNativePart(handle, call.input);
      const payload = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(part.bytes);
          controller.close();
        },
      });
      const result = reply(
        () =>
          decodeWireSync(HostNativePieces.read.response)({
            method: call.method,
            value: part.piece,
          }),
        payload,
        part.bytes.byteLength,
        guard,
      );
      holdOfficeNativeIO(handle, result.resource);
      return result.response;
    });
  } catch (error) {
    await input.close();
    throw error;
  }
}
