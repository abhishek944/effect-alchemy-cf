import { Effect, References } from "effect";

/** All labels are fixed application-owned names, never foreign text or request data. */
export interface FailureContext {
  readonly component: string;
  readonly operation: string;
  readonly reason?: string | undefined;
  readonly phase?: string | undefined;
  readonly route?: string | undefined;
  readonly provider?: string | undefined;
  readonly outcome?: "confirmed" | "failed" | "unknown" | "not-submitted" | "cancelled" | undefined;
  readonly level?: "ERROR" | "WARN" | "INFO" | undefined;
  readonly event?:
    | "application.failure"
    | "application.recovery"
    | "application.cleanup"
    | "application.denial"
    | "application.cancelled"
    | "application.phase"
    | "application.complete";
  readonly requestId?: string | undefined;
  readonly operationId?: string | undefined;
  readonly taskId?: string | number | undefined;
  readonly callId?: string | undefined;
  readonly submissionId?: string | undefined;
  readonly chatId?: string | undefined;
  readonly jobId?: string | undefined;
  readonly bootId?: string | undefined;
  readonly eventId?: string | undefined;
  readonly service?: string | undefined;
  readonly stage?: string | undefined;
  readonly release?: string | undefined;
  readonly status?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly deadlineAt?: number | undefined;
  readonly bytes?: number | undefined;
  readonly exitCode?: number | undefined;
}
export const diagnosticReason = Symbol("application.diagnostic.reason");
/** Preserve the native error and its cause; the reason is not serialized to public schemas. */
export function withDiagnostic<E extends Error>(error: E, reason: string): E {
  Object.defineProperty(error, diagnosticReason, { value: reason, configurable: true });
  return error;
}
export const label = (value: string | undefined) =>
  value !== undefined && /^[a-zA-Z0-9_.-]{1,96}$/.test(value) ? value : "unclassified";
const identity = (value: string | number | undefined) =>
  value !== undefined && /^[a-zA-Z0-9_.:-]{1,256}$/.test(String(value)) ? String(value) : undefined;
const safeLabel = (value: string | undefined) =>
  typeof value === "string" ? label(value) : undefined;
const metric = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
    ? value
    : undefined;
export function contextFields(context: FailureContext) {
  const fields = {
    request_id: identity(context.requestId),
    operation_id: identity(context.operationId),
    task_id: identity(context.taskId),
    call_id: identity(context.callId),
    submission_id: identity(context.submissionId),
    chat_id: identity(context.chatId),
    job_id: identity(context.jobId),
    boot_id: identity(context.bootId),
    event_id: identity(context.eventId),
    reason: safeLabel(context.reason),
    phase: safeLabel(context.phase),
    route: safeLabel(context.route),
    provider: safeLabel(context.provider),
    service: safeLabel(context.service),
    stage: safeLabel(context.stage),
    release: safeLabel(context.release),
    outcome: context.outcome,
    status: metric(context.status),
    duration_ms: metric(context.durationMs),
    deadline_at: metric(context.deadlineAt),
    bytes: metric(context.bytes),
    exit_code: metric(context.exitCode),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}
/** Read only nonsecret runtime metadata, never credentials or arbitrary environment fields. */
export function diagnosticMetadata(env: unknown) {
  const text = (key: string): string | undefined => {
    if (typeof env !== "object" || env === null) return undefined;
    try {
      const value: unknown = Object.getOwnPropertyDescriptor(env, key)?.value;
      return typeof value === "string" ? value : undefined;
    } catch {
      return undefined;
    }
  };
  return { service: text("OBS_SERVICE"), stage: text("OBS_STAGE"), release: text("OBS_RELEASE") };
}
export const requestDiagnosticContext = Effect.gen(function* () {
  const annotations = yield* References.CurrentLogAnnotations;
  const text = (key: string) =>
    typeof annotations[key] === "string" ? annotations[key] : undefined;
  return {
    requestId: text("diagnostic.request_id"),
    service: text("diagnostic.service"),
    stage: text("diagnostic.stage"),
    release: text("diagnostic.release"),
    route: text("diagnostic.route"),
  };
});
