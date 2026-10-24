/**
 * Narrow local browser diagnostics for G04/G06/G07.
 *
 * Local console projection only; there is no external collection service.
 * Every emitted field is a fixed application label, numeric status, build
 * identity, or a validated app-owned association id. Never pass user
 * objects, message content, URLs, nonces, channel/session credentials,
 * raw SDK errors, or response bodies through this module.
 */
const LABEL = /^[a-zA-Z0-9_.-]{1,96}$/;
const IDENTITY = /^(?:[A-Za-z0-9_-]{16,96}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/;
const REQUEST_ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
const safeLabel = (value: string | undefined): string =>
  value !== undefined && LABEL.test(value) ? value : "unclassified";
const safeIdentity = (value: string | null | undefined): string | undefined =>
  typeof value === "string" && IDENTITY.test(value) ? value : undefined;

/** Validated server diagnostic reference, or null when absent/foreign. */
export function readResponseRequestId(response: Response): string | null {
  const id = response.headers.get("x-request-id");
  return id !== null && REQUEST_ID.test(id) ? id : null;
}

/** Non-secret build identity for local root/frame error projection. */
export function browserBuild(): { service: string; release: string } {
  const raw =
    typeof import.meta !== "undefined" ? (import.meta.env?.VITE_APP_VERSION as unknown) : undefined;
  const release = typeof raw === "string" && LABEL.test(raw) ? raw : "dev";
  return { service: "web", release };
}

/**
 * Copyable safe reference for an HTTP/decode failure. The operation is a
 * fixed route template, never a raw path or identifier from a URL.
 */
export function serverReference(
  operation: string,
  status: number,
  requestId: string | null,
): string {
  const id = safeIdentity(requestId);
  return id ? `${safeLabel(operation)} · ${status} · ${id}` : `${safeLabel(operation)} · ${status}`;
}

/** Append the safe reference to an existing user-facing message. */
export function withReference(message: string, reference: string): string {
  return `${message} (ref ${reference})`;
}

export type BrowserEventInput = {
  component: string;
  operation: string;
  phase?: string | undefined;
  reason?: string | undefined;
  status?: number | undefined;
  /** App-owned association only (view id, frame request id). Never secrets. */
  associationId?: string | null | undefined;
  level?: "ERROR" | "WARN" | "INFO" | undefined;
  event?:
    | "application.failure"
    | "application.recovery"
    | "application.phase"
    | "application.complete"
    | undefined;
};

/**
 * Report once at the final handling owner. The browser console is the only
 * sink; the native browser error itself stays visible next to this record.
 */
export function reportBrowserEvent(input: BrowserEventInput): void {
  const level = input.level ?? (input.event === "application.phase" ? "INFO" : "ERROR");
  const record: Record<string, string | number> = {
    timestamp: new Date().toISOString(),
    level,
    event: input.event ?? "application.failure",
    service: browserBuild().service,
    release: browserBuild().release,
    component: safeLabel(input.component),
    operation: safeLabel(input.operation),
  };
  const phase = input.phase !== undefined ? safeLabel(input.phase) : undefined;
  const reason = input.reason !== undefined ? safeLabel(input.reason) : undefined;
  if (phase) record.phase = phase;
  if (reason) record.reason = reason;
  if (typeof input.status === "number" && Number.isSafeInteger(input.status))
    record.status = input.status;
  const association = safeIdentity(input.associationId);
  if (association) record.association_id = association;
  const line = JSON.stringify(record);
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
}

export type OfficeRuntimePhase = "init" | "snapshot" | "input" | "flush" | "ack" | "cleanup";
export class OfficeRuntimeError extends Error {
  readonly phase: OfficeRuntimePhase;
  readonly reason: string;
  readonly viewId: string | null;
  readonly operation: string;
  constructor(
    phase: OfficeRuntimePhase,
    reason: string,
    message: string,
    viewId: string | null,
    operation: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "OfficeRuntimeError";
    this.phase = phase;
    this.reason = reason;
    this.viewId = viewId;
    this.operation = operation;
    reportBrowserEvent({ component: "web", operation, phase, reason, associationId: viewId });
  }
}
/** Fixed user-safe copy per reason; the record carries phase/reason/view association. */
const OFFICE_MESSAGES: Record<string, string> = {
  "runtime-unavailable": "Office services are unavailable. Reload the page and try again.",
  "open-unconfirmed": "The Office document could not be opened. Reload and try again.",
  "document-changed": "Office document changed.",
  "frozen-view": "Invalid frozen Office view.",
  "generation-changed": "Office draft generation changed.",
  "branch-changed": "Office branch changed.",
  "anchor-changed": "Save and reopen this Office tab before Send; its displayed anchor changed.",
  "editor-unavailable": "Office editor authority is unavailable.",
  "channel-unconfirmed": "The Office channel could not be confirmed. Reload and try again.",
  "channel-expired": "Office channel expired.",
  "ack-unavailable": "Native save acknowledgement is unavailable.",
  "drain-unconfirmed": "Editor drain is unconfirmed.",
  "revoke-unconfirmed": "Unused editor cleanup is unconfirmed.",
  "head-changed": "The saved head changed.",
};
/** Classify once with a fixed phase/reason; aborts and classified errors pass through. */
export function officeFail(
  op: string,
  phase: OfficeRuntimePhase,
  reason: string,
  viewId: string | null,
  cause?: unknown,
  signal?: AbortSignal,
): never {
  if (cause instanceof OfficeRuntimeError) throw cause;
  if (signal?.aborted) throw cause ?? signal.reason;
  const message = OFFICE_MESSAGES[reason] ?? "The Office request could not be completed.";
  throw new OfficeRuntimeError(phase, reason, message, viewId, op, cause);
}

const onError = () =>
  reportBrowserEvent({
    component: "web",
    operation: "app.root",
    phase: "render",
    reason: "window-error",
  });
const onRejection = (event: PromiseRejectionEvent) => {
  if (event.reason instanceof DOMException && event.reason.name === "AbortError") return;
  reportBrowserEvent({
    component: "web",
    operation: "app.root",
    phase: "async",
    reason: "unhandled-rejection",
  });
};

let collectorsInstalled = false;
/**
 * Minimal local capture for render/async failures (G07). Reports fixed
 * phase/reason records only; raw messages stay in the browser's own error
 * output and are never forwarded anywhere.
 */
export function registerBrowserCollectors(): () => void {
  if (typeof window === "undefined" || collectorsInstalled) return () => {};
  collectorsInstalled = true;
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);
  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    collectorsInstalled = false;
  };
}
