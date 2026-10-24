import type { ImageHost } from "@abhishek944/pi-image-gen/core";
import { reportFailure } from "@starter/diagnostics";
import { readAcceptedOriginal } from "./chat-image-original.ts";
import { runImageIO } from "./chat-image-io.ts";
import { retainImageResponseBody } from "./chat-image-io-response.ts";
import { ImageIOError } from "./chat-image-io-error.ts";
import {
  NATIVE_IMAGE_RESPONSE_BYTES,
  NATIVE_IMAGE_TIMEOUT_MS,
  nativeImageLimits,
} from "./chat-image-policy.ts";
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

/** The single established provider-output origin: AI Gateway's own object storage. */
const GATEWAY_OUTPUT_HOST_PREFIX = "ai-gateway-outputs.";
const GATEWAY_OUTPUT_HOST_SUFFIX = ".r2.cloudflarestorage.com";

/** https-only allowlist for Gateway-minted output links; every other URL stays refused. */
function safeGatewayOutputUrl(value: string): URL | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (parsed.username !== "" || parsed.password !== "") return null;
  const host = parsed.hostname.toLowerCase();
  if (!host.startsWith(GATEWAY_OUTPUT_HOST_PREFIX) || !host.endsWith(GATEWAY_OUTPUT_HOST_SUFFIX))
    return null;
  return parsed;
}

/** No serializer: the package's exact model/input/options go to the actual binding. */
export function imageHostIO(
  execution: ImageHostExecution,
  context: ImageHostContext,
): ImageHost<SavedFile> {
  const { deps, plan, lifetime, client } = execution;
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
        },
        track: lifetime.track,
        ...(signal === undefined ? {} : { signal }),
      });
    },
    async loadOutput(providerUrl, signal) {
      const parsed = safeGatewayOutputUrl(providerUrl);
      if (parsed === null)
        throw new ImageIOError("output_url_refused", "Image output URLs are not enabled.");
      signal?.throwIfAborted();
      const response = await fetch(parsed.toString(), { signal: signal ?? null });
      if (!response.ok) throw new ImageIOError("io_failed", "The image output download failed.");
      const buffer = await response.arrayBuffer();
      signal?.throwIfAborted();
      return {
        bytes: new Uint8Array(buffer),
        mimeType: response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ?? "",
      };
    },
    cloudflareRun(model, input, options) {
      return runImageIO({
        track: lifetime.track,
        signal: options.signal,
        async run() {
          assertImageHostReady(deps, context);
          options.signal?.throwIfAborted();
          assertImageHostLogical(execution);
          try {
            await deps.dispatchGate(plan.proof.snapshot.operationId);
          } catch (error) {
            reportFailure(error, {
              component: "chat-image",
              operation: "dispatch-gate",
              event: options.signal?.aborted ? "application.cancelled" : "application.failure",
              operationId: plan.proof.snapshot.operationId,
              callId: plan.key,
            });
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
          // Log every image request at the gateway: the package defaults
          // per-request collection off, which would hide these calls.
          const loggingOptions = {
            ...options,
            gateway: { ...options.gateway, collectLog: true },
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- deliberate opt-in: Workers AI accepts boolean, package types pin false.
          } as unknown as typeof options;
          const raw = await binding(model, input, loggingOptions);
          if (!(raw instanceof Response))
            throw new ImageIOError("io_failed", "The image binding did not return a raw response.");
          // Headers-only transport completion is not body completion.
          const response = await retainImageResponseBody({
            response: raw,
            track: lifetime.track,
            responseBytes: NATIVE_IMAGE_RESPONSE_BYTES,
            operationId: plan.proof.snapshot.operationId,
            ...(options.signal === undefined ? {} : { signal: options.signal }),
          });
          execution.responses.add(response);
          return response;
        },
        async disposeLate(response) {
          await response.body?.cancel().catch(() => undefined);
        },
        onLateFailure(error) {
          if (!execution.dispatched) return;
          reportFailure(error, {
            component: "chat-image",
            operation: "late-provider",
            event: "application.failure",
            operationId: plan.proof.snapshot.operationId,
            callId: plan.key,
          });
        },
      });
    },
    store(output, index, storeContext) {
      storeContext.signal.throwIfAborted();
      execution.storing = true;
      return lifetime.track(async () => {
        // Track hash + real RPC/PUT/receipt, not core's abort-raced await.
        const file = await sink(output, index, storeContext);
        rememberImageHostFile(execution, index, file);
        return file;
      });
    },
  };
}
