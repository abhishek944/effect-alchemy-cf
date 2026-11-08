/**
 * Owner-catalog call accounting for one image invocation.
 *
 * Recording failure evidence is best effort but explicit; it never invents a
 * total, releases an uncertain dispatch or replays the paid request. `finish`
 * acknowledges dispatch ownership only when the owner gives an authoritative
 * answer; a transport timeout is not proof that no reservation exists.
 */
import type { ImageMetadata } from "@abhishek944/pi-image-gen/core";
import { reportFailure } from "@highchat/diagnostics";
import type { ImageCallFile } from "./chat-image-call-schema.ts";
import { ImageStorageError } from "./chat-image-storage-schema.ts";
import type { ImageResponseCandidate } from "./chat-image-response-schema.ts";
import type { ChatSdkImagesDeps } from "./chat-sdk-files-types.ts";
import type { ChatGeneratedClient } from "./chat-generated-client.ts";
import type { ImageHostRuntime } from "./chat-sdk-images-host.ts";
import { imageFileEntries, safeImageError } from "./chat-sdk-images-result.ts";
import type { ImageOutcome } from "./chat-sdk-images-result.ts";

export const finishImageCall = async (
  deps: ChatSdkImagesDeps,
  client: ChatGeneratedClient,
  candidate: ImageResponseCandidate,
  key: string,
): Promise<void> => {
  let acknowledged = false;
  try {
    const result = await client.finish({ chatId: candidate.chatId, callId: key });
    acknowledged = Number.isSafeInteger(result.pendingBytes) && result.pendingBytes >= 0;
  } catch (error) {
    acknowledged = error instanceof ImageStorageError && error.code === "not_admitted";
    if (!acknowledged)
      reportFailure(error, {
        component: "chat-image-host",
        operation: "owner-finalization",
        callId: key,
        event: "application.failure",
      });
  }
  if (acknowledged) deps.calls.acknowledgeOwnerFinalization(key);
};

export const recordImageFailure = (
  deps: ChatSdkImagesDeps,
  key: string,
  runtime: ImageHostRuntime | undefined,
  error: unknown,
): ImageOutcome => {
  let outcome: ImageOutcome = {
    dispatched: false,
    uncertain: false,
    storageUncertain: false,
    partial: false,
  };
  let metadata: ImageMetadata | undefined;
  if (runtime !== undefined) {
    const failure = safeImageError(error, runtime.state);
    outcome = failure.outcome;
    metadata = failure.metadata;
  }
  const files: readonly ImageCallFile[] =
    runtime === undefined
      ? []
      : imageFileEntries(runtime.state).map((entry) => ({ index: entry.index, file: entry.file }));
  try {
    deps.calls.record(key, {
      status: outcome.dispatched ? "unresolved" : "failed",
      outcome,
      files,
      ...(metadata === undefined ? {} : { metadata }),
    });
  } catch (recordError) {
    reportFailure(recordError, {
      component: "chat-image-host",
      operation: "record-failure",
      callId: key,
      event: "application.failure",
    });
  }
  return outcome;
};
