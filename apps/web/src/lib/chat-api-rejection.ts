import { isUuid } from "@/lib/chat-validate-base";

/** Strict terminal rejection; every other error stays generic and uncertain. */
export type NoAdmissionRejection = {
  terminal: true;
  code: "skills_not_admitted";
  operationId: string;
  logicalOperationId: string;
};

/**
 * Shape-only classification; only the expected HTTP status may return a
 * terminal rejection, and the public tag/message bounds are validated too.
 */
export const rejectionOf = (body: unknown, status: number): NoAdmissionRejection | null => {
  if (status !== 409) return null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (Reflect.get(body, "_tag") !== "SkillAttemptNoAdmission") return null;
  if (Reflect.get(body, "terminal") !== true) return null;
  if (Reflect.get(body, "code") !== "skills_not_admitted") return null;
  const message: unknown = Reflect.get(body, "message");
  if (typeof message !== "string" || message.length === 0 || message.length > 256) return null;
  const operationId: unknown = Reflect.get(body, "operationId");
  const logicalOperationId: unknown = Reflect.get(body, "logicalOperationId");
  if (typeof operationId !== "string" || typeof logicalOperationId !== "string") return null;
  if (!isUuid(operationId) || !isUuid(logicalOperationId)) return null;
  return { terminal: true, code: "skills_not_admitted", operationId, logicalOperationId };
};
