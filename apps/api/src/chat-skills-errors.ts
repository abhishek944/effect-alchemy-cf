/** Typed skill failures shared by the attempt lifecycle and request facade. */
import { reportFailure, withCause, withDiagnostic } from "@starter/diagnostics";
import { SkillDocumentError } from "./chat-skills-document.ts";
import { SkillLibraryError } from "./chat-skills-library.ts";

export const SKILLS_UNAVAILABLE =
  "Skills are temporarily unavailable. Your message and files are unchanged; try again.";
export const SKILLS_INTEGRITY =
  "Your skill library could not be verified, so nothing was sent. Nothing was changed.";
export const SKILLS_UNRECOVERABLE =
  "The original skill version is no longer available, so this answer cannot be retried. New Send continues with your current skills.";
export const SKILLS_UNKNOWN_PROVENANCE =
  "This answer's skill provenance could not be verified; this answer is incomplete.";
export const SKILLS_PINNED_UNAVAILABLE =
  "The pinned skill state is unavailable; this answer is incomplete.";
export const SKILLS_INCOMPLETE = "A skill could not load; this answer is incomplete.";
export const SKILLS_BUDGET =
  "Active skill instructions exceed the request budget; nothing was truncated.";
export const SKILLS_REQUEST_BUDGET =
  "The pinned skill context does not fit this model's remaining budget; this answer is incomplete.";

export type SkillRuntimeErrorCode = "unavailable" | "integrity" | "unrecoverable" | "invalid";

export class SkillRuntimeError extends Error {
  readonly code: SkillRuntimeErrorCode;
  constructor(code: SkillRuntimeErrorCode, message: string) {
    super(message);
    this.name = "SkillRuntimeError";
    this.code = code;
  }
}

/** Final recovery owner for a swallowed skill persistence/abort observation. */
export const reportSkillRecovery = (
  error: unknown,
  operation: string,
  reason: string,
  operationId: string,
  taskId?: string | number,
): void =>
  reportFailure(error, {
    component: "skills",
    operation,
    reason,
    operationId,
    ...(taskId === undefined ? {} : { taskId: String(taskId) }),
    event: "application.recovery",
  });

const translated = (
  code: SkillRuntimeErrorCode,
  message: string,
  reason: string,
): SkillRuntimeError => withDiagnostic(new SkillRuntimeError(code, message), reason);

export const translateSkillError = (error: unknown): SkillRuntimeError => {
  if (error instanceof SkillRuntimeError) return error;
  if (error instanceof SkillLibraryError) {
    const integrity = error.kind === "integrity";
    return withCause(
      translated(
        integrity ? "integrity" : "unavailable",
        integrity ? SKILLS_INTEGRITY : SKILLS_UNAVAILABLE,
        integrity ? "skills_library_integrity" : "skills_library_unavailable",
      ),
      error,
    );
  }
  if (error instanceof SkillDocumentError)
    return withCause(
      translated("unavailable", SKILLS_UNAVAILABLE, "skills_document_unavailable"),
      error,
    );
  return withCause(
    translated("unavailable", SKILLS_UNAVAILABLE, "skills_translation_unknown"),
    error,
  );
};
