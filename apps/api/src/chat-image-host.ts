import type { DurableImageHost } from "@abhishek944/pi-image-gen/durable";
import { reportFailure } from "@starter/diagnostics";
import { createChatGeneratedClient } from "./chat-generated-client.ts";
import { prepareImageHostPlan, recheckImageHostPlan } from "./chat-image-host-proof.ts";
import { imageHostRefusal } from "./chat-image-host-sources.ts";
import { createImageHostLifetime } from "./chat-image-host-lifetime.ts";
import { assertImageHostLogical, imageHostIO } from "./chat-image-host-io.ts";
import { nativeImageLimits } from "./chat-image-policy.ts";
import {
  imageHostToolResult,
  rememberImageHostMetadata,
  safeImageCoreError,
} from "./chat-image-host-result.ts";
import {
  closeImageHost,
  detachImageHost,
  failClosedImageHost,
  imageHostFiles,
  recordImageHost,
  recoverImageHostPlan,
} from "./chat-image-host-settlement.ts";
import type {
  ChatImageHostDependencies,
  ImageHostExecution,
  ImageHostLifetime,
  ImageHostOutcome,
  ImageHostPlan,
} from "./chat-image-host-types.ts";
import type { SavedFile } from "./chat-library-schema.ts";

export type { ChatImageHostDependencies } from "./chat-image-host-types.ts";

/** Standalone production adapter. Parent alone installs it in the real native registry. */
export function createChatImageHost(deps: ChatImageHostDependencies): DurableImageHost<SavedFile> {
  let paidBlocked = false;
  return {
    async runAdmittedCall(api, context, args, run) {
      let plan: ImageHostPlan | undefined;
      let lifetime: ImageHostLifetime | undefined;
      let execution: ImageHostExecution | undefined;
      let ownsStart = false;
      let ownerReservationAttempted = false;
      let outcome: ImageHostOutcome = {
        dispatched: false,
        uncertain: false,
        storageUncertain: false,
        partial: false,
      };
      try {
        if (paidBlocked) return imageHostToolResult(undefined);
        plan = await prepareImageHostPlan(deps, api, context, args);
        const known = deps.calls.read(plan.key);
        if (known === null) return imageHostRefusal();
        if (known.started || known.status !== "prepared") return recoverImageHostPlan(deps, plan);
        lifetime = createImageHostLifetime();
        execution = {
          deps,
          plan,
          lifetime,
          client: createChatGeneratedClient(deps.catalog),
          files: new Map(),
          responses: new Set(),
          paidBlocked: () => paidBlocked,
          blockPaid: () => {
            paidBlocked = true;
          },
          dispatched: false,
          storing: false,
        };
        assertImageHostLogical(execution);
        await recheckImageHostPlan(deps, plan, api, context);
        // Persist one local owner before any async reservation/consume; duplicates cannot close it.
        ownsStart = deps.calls.start(plan.key);
        if (!ownsStart) return recoverImageHostPlan(deps, plan);
        const snapshot = plan.proof.snapshot;
        const image = snapshot.image;
        if (image.state !== "ready") return imageHostRefusal();
        const referenceBytes = plan.sources.reduce(
          (sum, item) => sum + item.authority.file.byteSize,
          0,
        );
        const limits = nativeImageLimits(referenceBytes);
        const key = { chatId: snapshot.chatId, callId: plan.key };
        const client = execution.client;
        const requestDigest = plan.requestDigest;
        const sources = plan.sources.map((source) => source.authority.file.id);
        const size = plan.proof.args.size ?? image.preferences.size;
        const quality = plan.proof.args.quality ?? image.preferences.quality;
        ownerReservationAttempted = true;
        await lifetime.track(() =>
          client.reserve({
            ...key,
            operationId: snapshot.operationId,
            requestDigest,
            maxOutputBytes: limits.imageBytes ?? 0,
            sources,
            model: image.preferences.model,
            size,
            quality,
          }),
        );
        await recheckImageHostPlan(deps, plan, api, context);
        assertImageHostLogical(execution);
        const permission = await lifetime.track(() => client.consume(key));
        if (!permission.dispatch) return recoverImageHostPlan(deps, plan);
        await recheckImageHostPlan(deps, plan, api, context);
        assertImageHostLogical(execution);
        const host = imageHostIO(execution, context);
        const request = plan.request;
        const result = await lifetime.track(() => run(host, request));
        rememberImageHostMetadata(execution, result.metadata);
        if (!execution.dispatched || result.images.length !== execution.files.size)
          return imageHostRefusal();
        outcome = { dispatched: true, uncertain: false, storageUncertain: false, partial: false };
        recordImageHost(execution, "complete", outcome);
        return imageHostToolResult(
          plan,
          imageHostFiles(execution).map(({ file }) => file),
          outcome,
          "Image saved. Use its exact original link for viewing or a later explicit edit request.",
          false,
        );
      } catch (error) {
        reportFailure(error, {
          component: "chat-image-host",
          operation: "run-admitted-call",
          event: "application.failure",
          ...(plan === undefined
            ? {}
            : { operationId: plan.proof.snapshot.operationId, callId: plan.key }),
        });
        if (execution !== undefined) {
          const failure = safeImageCoreError(error, execution);
          outcome = failure.outcome;
          if (failure.metadata !== undefined) execution.metadata = failure.metadata;
          try {
            recordImageHost(
              execution,
              outcome.uncertain || outcome.storageUncertain ? "unresolved" : "failed",
              outcome,
            );
          } catch {
            failClosedImageHost(execution, outcome);
          }
        } else if (plan !== undefined) {
          try {
            deps.calls.record(plan.key, { status: "failed", outcome, files: [] });
          } catch {
            paidBlocked = true;
          }
        }
        return imageHostToolResult(
          plan,
          execution === undefined ? [] : imageHostFiles(execution).map(({ file }) => file),
          outcome,
          outcome.dispatched
            ? "Image work did not finish cleanly. Saved results are retained. Do not repeat generation without a new explicit request."
            : "This invocation did not contact the image provider. Image settings, references, admission or storage quota could not be verified.",
        );
      } finally {
        if (execution !== undefined && ownsStart)
          closeImageHost(execution, outcome, ownerReservationAttempted);
        else {
          if (plan !== undefined)
            detachImageHost(
              deps,
              Promise.resolve()
                .then(() => deps.notify())
                .then(() => undefined),
            );
        }
      }
    },
  };
}
