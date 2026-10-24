import {
  diagnosticMetadata,
  reportEvent,
  reportFailure,
  type FailureContext,
} from "@starter/diagnostics";
import type { LiveState, SubmissionRecord } from "@earendil-works/pi-durable";
import { Effect, ErrorReporter, References } from "effect";

/** Safe, nonsecret composition labels; absent values stay absent. */
export type ChatObjectMetadata = Pick<FailureContext, "service" | "stage" | "release">;

/** Observation-only correlation for private object calls; never authorization. */
export const CHAT_OBSERVATION_REQUEST = "x-chat-observation-request";
const identity = /^[A-Za-z0-9_.:-]{1,256}$/;

export const chatObservationHeaders: Effect.Effect<Record<string, string>> = Effect.gen(
  function* () {
    const annotations = yield* References.CurrentLogAnnotations;
    const requestId = annotations["diagnostic.request_id"];
    return typeof requestId === "string" && identity.test(requestId)
      ? { [CHAT_OBSERVATION_REQUEST]: requestId }
      : {};
  },
);

export const chatObjectMetadata = (env: unknown): ChatObjectMetadata => diagnosticMetadata(env);

/** Caller-immutable request correlation for one private call; never authority or browser input. */
export const chatRequestObservation = (request: Request): Pick<FailureContext, "requestId"> => {
  const value = request.headers.get(CHAT_OBSERVATION_REQUEST);
  return value !== null && identity.test(value) ? { requestId: value } : {};
};

/** Finite handler label from the private route head; never the raw path or query. */
const handlerOperation = (request: Request): string => {
  const head = new URL(request.url).pathname.split("/")[1] ?? "";
  if (head === "events") return "events";
  if (head === "snapshot") return "snapshot";
  if (head === "messages") return "send";
  if (head === "stop") return "stop";
  if (head === "title") return "title";
  if (head === "resolve") return "office-task";
  if (head === "usage" || head === "image-usage") return "usage";
  if (head === "images" || head === "image-files") return "images";
  if (head === "files") return "files";
  if (head === "skills") return "skills";
  if (head === "profile") return "profile";
  if (head === "theme") return "theme";
  if (head === "speech") return "speech";
  if (head === "preferences" || head === "capabilities") return "preferences";
  if (head === "admit" || head === "release") return "admission";
  if (head === "get" || head === "list" || head === "create" || head === "patch") return "metadata";
  if (head === "owner") return "owner";
  return request.method === "GET" ? "read" : "dispatch";
};

/** Handler attribution plus explicit non-authority request correlation. */
export const reportObjectFailure = (
  error: unknown,
  owner: "conversation" | "catalog",
  request: Request,
  chatId: string | undefined,
  metadata: ChatObjectMetadata,
  extra?: { readonly operation?: string; readonly phase?: string; readonly operationId?: string },
): void => {
  if (ErrorReporter.isIgnored(error)) return;
  reportFailure(error, {
    ...metadata,
    ...chatRequestObservation(request),
    component: owner === "conversation" ? "chat-conversation" : "chat-catalog",
    operation: handlerOperation(request),
    chatId,
    ...extra,
  });
};

/** Caller-known event-stream association; the relay owns its own failure reason. */
export const chatEventContext = (
  request: Request,
  chatId: string,
  metadata: ChatObjectMetadata,
): FailureContext => ({
  ...metadata,
  ...chatRequestObservation(request),
  component: "chat-conversation",
  operation: "events",
  chatId,
});

/** Scheduled callback owner: report an escaped sweep failure once, then keep its throw. */
export const reportCatalogSweep = (
  error: unknown,
  operation: string,
  metadata: ChatObjectMetadata,
): void => {
  if (ErrorReporter.isIgnored(error)) return;
  reportFailure(error, {
    ...metadata,
    component: "chat-catalog",
    operation,
    event: "application.recovery",
  });
};

type Settlement = Extract<SubmissionRecord, { status: "unanswered" }>;

/** Fixed safe reasons; the persisted native reason and detail text never leave storage. */
const SETTLEMENTS: Readonly<Record<string, string>> = {
  aborted: "settlement-aborted",
  stale: "settlement-stale",
  model_error: "settlement-model-error",
  no_model: "settlement-no-model",
  faulted: "settlement-faulted",
  reset: "settlement-reset",
};
const UNCLASSIFIED = "settlement-unanswered";

/** Exactly once, at the ledger transition that settles the run. */
export const reportSettlement = (
  record: Settlement,
  ids: { readonly operationId: string; readonly chatId: string },
  metadata: ChatObjectMetadata,
): void => {
  const known: unknown = Object.getOwnPropertyDescriptor(SETTLEMENTS, record.reason)?.value;
  const reason = typeof known === "string" ? known : UNCLASSIFIED;
  const cancelled = reason === "settlement-aborted";
  reportFailure(undefined, {
    ...metadata,
    component: "chat-runtime",
    operation: "run-settlement",
    reason,
    outcome: cancelled ? "cancelled" : "failed",
    event: cancelled ? "application.cancelled" : "application.failure",
    ...(reason === "settlement-stale" || reason === "settlement-reset" ? { level: "WARN" } : {}),
    operationId: ids.operationId,
    submissionId: String(record.id),
    chatId: ids.chatId,
  });
};

export type RetryWatch = { key: string | null };

/** One INFO phase per observed retry attempt; provider retry text is never read. */
export const watchRetry = (
  watch: RetryWatch,
  chatId: string,
  live: {
    readonly operation: string | null;
    readonly native?: Readonly<LiveState> | undefined;
  },
  metadata: ChatObjectMetadata,
): boolean => {
  const generation = live.native?.generation;
  if (generation?.retry === undefined) {
    watch.key = null;
    return false;
  }
  const key = `${live.operation ?? "none"}:${generation.attempt ?? 0}`;
  if (watch.key !== key) {
    watch.key = key;
    reportEvent({
      ...metadata,
      component: "chat-runtime",
      operation: "generation-retry",
      phase: "retry-wait",
      reason: "retry-deferred",
      outcome: "unknown",
      chatId,
      operationId: live.operation ?? undefined,
      taskId: live.native?.run?.taskId,
    });
  }
  return true;
};

/** One final report at the send owner; a failure its final owner already reported stays silent. */
export const reportSendFailure = (
  error: unknown,
  ids: Pick<FailureContext, "requestId"> & {
    readonly operationId: string;
    readonly chatId: string;
  },
  progress: { readonly phase: string; readonly outcome: FailureContext["outcome"] },
  metadata: ChatObjectMetadata,
): void => {
  if (ErrorReporter.isIgnored(error)) return;
  reportFailure(error, {
    ...metadata,
    requestId: ids.requestId,
    ...progress,
    component: "chat-submission",
    operation: "send",
    operationId: ids.operationId,
    chatId: ids.chatId,
  });
};
