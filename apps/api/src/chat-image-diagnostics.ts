// Native structured event: the Effect diagnostic logger intentionally drops causes at this boundary.
import type { TaskId } from "@earendil-works/pi-durable";
import { ImageIOError, type ImageIOCode } from "./chat-image-io-error.ts";
import { ImageHydrationError, type ImageHydrationCode } from "./chat-image-hydration-types.ts";

/** Fixed local guard boundaries. Never arbitrary labels or caller-supplied data. */
export type ImageDiagnosticBoundary = "prepare" | "hook" | "verify";
export type ImageDiagnosticPhase =
  | "proof_take"
  | "context"
  | "state"
  | "view_comparison"
  | "input_mapping"
  | "bridge_verify"
  | "skill_preparation"
  | "legacy_preparation"
  | "canonicalization"
  | "remap"
  | "acceptance_repair"
  | "original_hydration"
  | "final_verification"
  | "transport_admission";
export type ImageDiagnosticReason = "refused" | "failed";
export type ImageDiagnosticCause =
  | "none"
  | "aborted"
  | "unclassified"
  | ImageHydrationCode
  | ImageIOCode;

/** Trusted opaque proof correlation only; no account, user, chat or message identity. */
export type ImageDiagnosticCorrelation = {
  readonly operationId: string;
  readonly taskId: TaskId;
};

const failureCause = (error: unknown): ImageDiagnosticCause => {
  try {
    if (error instanceof ImageHydrationError) return error.code;
    if (error instanceof ImageIOError) return error.code;
    if (typeof error === "object" && error !== null && Reflect.get(error, "name") === "AbortError")
      return "aborted";
  } catch {
    // Foreign errors may trap classification access; never log their raw properties.
  }
  return "unclassified";
};

const emit = (
  boundary: ImageDiagnosticBoundary,
  phase: ImageDiagnosticPhase,
  reason: ImageDiagnosticReason,
  cause: ImageDiagnosticCause,
  correlation: ImageDiagnosticCorrelation | undefined,
): void => {
  try {
    const record = {
      timestamp: new Date().toISOString(),
      level: reason === "refused" ? "WARN" : "ERROR",
      event: "chat.image.diagnostic",
      boundary,
      phase,
      reason,
      cause,
      ...(correlation === undefined
        ? {}
        : { operation_id: correlation.operationId, task_id: correlation.taskId }),
    };
    if (reason === "refused") console.warn(JSON.stringify(record));
    else console.error(JSON.stringify(record));
  } catch {
    // Best effort: diagnostics must never influence a guard outcome.
  }
};

export const imageDiagnosticRefused = (
  boundary: ImageDiagnosticBoundary,
  phase: ImageDiagnosticPhase,
  correlation?: ImageDiagnosticCorrelation,
): void => emit(boundary, phase, "refused", "none", correlation);

export const imageDiagnosticFailed = (
  boundary: ImageDiagnosticBoundary,
  phase: ImageDiagnosticPhase,
  error: unknown,
  correlation?: ImageDiagnosticCorrelation,
): void => emit(boundary, phase, "failed", failureCause(error), correlation);
