import type { ImageHost } from "@abhishek944/pi-image-gen/core";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { runImageIO } from "./chat-image-io.ts";
import { retainImageResponseBody } from "./chat-image-io-response.ts";
import { ImageIOError } from "./chat-image-io-error.ts";
import { NATIVE_IMAGE_TIMEOUT_MS, nativeImageLimits } from "./chat-image-policy.ts";
import { assertImageHostReady } from "./chat-image-host-proof.ts";
import { imageHostRefusal } from "./chat-image-host-sources.ts";
import { rememberImageHostFile } from "./chat-image-host-settlement.ts";
import type { ImageHostContext, ImageHostExecution } from "./chat-image-host-types.ts";
import type { SavedFile } from "./chat-library-schema.ts";

export function assertImageHostLogical(execution: ImageHostExecution): void {
  const { deps, plan } = execution;
  const snapshot = plan.proof.snapshot;
  if (
    execution.paidBlocked() ||
    deps.calls.logicalState(snapshot.logicalOperationId, snapshot.operationId).started ||
    deps.calls.logicalState(snapshot.logicalOperationId).blocked
  )
    imageHostRefusal();
}

/** No serializer: the package's exact model/input/options go to the actual binding. */
export function imageHostIO(
  execution: ImageHostExecution,
  context: ImageHostContext,
): ImageHost<SavedFile> {
  const { deps, plan, lifetime, client } = execution;
  const lease = lifetime.lease;
  // Same decoder ceiling already included by T27's generation memory estimate.
  const backingLimit = Math.max(lease.outputBytes, Math.ceil((lease.responseBytes * 3) / 4));
  const ownerScope = deps.catalog.id.toString();
  if (ownerScope !== deps.expectedOwnerScope) return imageHostRefusal();
  const referenceBytes = plan.sources.reduce((sum, item) => sum + item.authority.file.byteSize, 0);
  const sink = client.sink({ chatId: plan.proof.snapshot.chatId, callId: plan.key });
  return {
    ...(context.abortSignal === undefined ? {} : { signal: context.abortSignal }),
    timeoutMs: NATIVE_IMAGE_TIMEOUT_MS,
    limits: nativeImageLimits(referenceBytes),
    loadOriginal(reference, signal) {
      const source = plan.sources[reference.index];
      if (reference.role !== "image" || source === undefined || source.url !== reference.url)
        return Promise.reject(new Error("The original image is not authorized."));
      return readAcceptedOriginal({
        bucket: deps.bucket,
        ownerScope,
        chatId: plan.proof.snapshot.chatId,
        metadata: {
          state: "accepted",
          ownerScope,
          file: source.authority.file,
          digest: source.authority.digest,
        },
        lease,
        ...(signal === undefined ? {} : { signal }),
      });
    },
    async loadOutput() {
      // No provider output origins are established. Do not fetch an arbitrary URL or invent DNS safety.
      throw new ImageIOError("output_url_refused", "Image output URLs are not enabled.");
    },
    cloudflareRun(model, input, options) {
      return runImageIO({
        lease,
        signal: options.signal,
        async run() {
          assertImageHostReady(deps, context);
          options.signal?.throwIfAborted();
          assertImageHostLogical(execution);
          try {
            await deps.dispatchGate(plan.proof.snapshot.operationId);
          } catch {
            return imageHostRefusal();
          }
          // Stop, readiness or the logical state may have changed while the
          // gate verified; recheck them and add a synchronous exact-operation
          // fence immediately before markDispatched/the paid binding call.
          assertImageHostReady(deps, context);
          options.signal?.throwIfAborted();
          assertImageHostLogical(execution);
          if (deps.dispatchFence(plan.proof.snapshot.operationId) !== null)
            return imageHostRefusal();
          const frozen = plan.proof.snapshot.image;
          const binding = deps.cloudflareRun;
          if (
            frozen.state !== "ready" ||
            !deps.configurationReady(frozen) ||
            model !== frozen.model ||
            options.gateway.id !== frozen.gatewayId ||
            binding === undefined ||
            !deps.calls.markDispatched(plan.key)
          )
            return imageHostRefusal();
          execution.dispatched = true;
          const raw = await binding(model, input, options);
          if (!(raw instanceof Response))
            throw new ImageIOError("io_failed", "The image binding did not return a raw response.");
          // Headers-only transport completion is not body completion.
          const response = await retainImageResponseBody({
            response: raw,
            lease,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          execution.responses.add(response);
          return response;
        },
        async disposeLate(response) {
          await response.body?.cancel().catch(() => undefined);
        },
      });
    },
    store(output, index, storeContext) {
      storeContext.signal.throwIfAborted();
      if (!(output.bytes.buffer instanceof ArrayBuffer)) return imageHostRefusal();
      const backingBytes = output.bytes.buffer.byteLength;
      if (backingBytes > backingLimit - execution.retainedOutputBackingBytes)
        throw new ImageIOError("lease_capacity", "Image output backing exceeds reserved memory.");
      lease.claim("output", output.bytes.byteLength);
      execution.retainedOutputBackingBytes += backingBytes;
      execution.storing = true;
      return lease.track(async () => {
        // Track hash + real RPC/PUT/receipt, not core's abort-raced await.
        const file = await sink(output, index, storeContext);
        rememberImageHostFile(execution, index, file);
        return file;
      });
    },
  };
}
