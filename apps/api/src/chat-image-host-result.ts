import { ImageCoreError, type ImageMetadata } from "@abhishek944/pi-image-gen/core";
import type { ToolExecutionResult } from "@earendil-works/pi-durable";
import { ImageCallMetadata } from "./chat-image-call-schema.ts";
import { decodeOption } from "./chat-internal.ts";
import type {
  ImageHostExecution,
  ImageHostOutcome,
  ImageHostPlan,
} from "./chat-image-host-types.ts";
import type { SavedFile } from "./chat-library-schema.ts";

/** Never echo error messages, provider URLs/bodies or raw package errors into native results. */
export function safeImageCoreError(
  error: unknown,
  execution: ImageHostExecution,
): { outcome: ImageHostOutcome; metadata?: ImageMetadata } {
  const core = error instanceof ImageCoreError ? error : undefined;
  const metadata = core === undefined ? null : decodeOption(ImageCallMetadata, core.metadata);
  const known = metadata ?? execution.metadata;
  const dispatched = execution.dispatched;
  return {
    outcome: {
      dispatched,
      uncertain: dispatched && (core?.outcome.uncertain ?? known === undefined),
      storageUncertain: dispatched && execution.storing && (core?.outcome.storageUncertain ?? true),
      partial: dispatched && (execution.files.size > 0 || core?.outcome.partial === true),
    },
    ...(dispatched && known !== undefined ? { metadata: known } : {}),
  };
}

export function rememberImageHostMetadata(
  execution: ImageHostExecution,
  metadata: ImageMetadata,
): void {
  const safe = decodeOption(ImageCallMetadata, metadata);
  if (safe === null) throw new Error("Image accounting could not be verified.");
  execution.metadata = safe;
}

export function imageHostToolResult(
  plan: ImageHostPlan | undefined,
  files: Iterable<SavedFile> = [],
  outcome?: ImageHostOutcome,
  message = "Image work could not be admitted. This invocation did not send an image provider request.",
  isError = true,
): ToolExecutionResult {
  const links =
    plan === undefined
      ? []
      : [...files].slice(0, 30).map((file) => {
          const url = `${plan.proof.snapshot.applicationOrigin}/api/chats/${file.chatId}/attachments/${file.id}`;
          return `${file.state === "unavailable" ? "Unavailable saved image" : "Saved image"}: ${url}`;
        });
  return {
    isError,
    content: [{ type: "text", text: [message, ...links].join("\n") }],
    details: {
      ...(plan === undefined ? {} : { imageCallKey: plan.key }),
      ...(outcome === undefined
        ? {}
        : {
            dispatched: outcome.dispatched,
            uncertain: outcome.uncertain,
            storageUncertain: outcome.storageUncertain,
            partial: outcome.partial,
          }),
    },
  };
}
