/**
 * Bounded durable negative authority for one exact New Send UUID.
 *
 * A fence is written only after an authenticated, serialized server decision
 * proved no native input and no queued/in-flight ambiguity for that exact
 * operation. It is cumulative and bounded per conversation: at the cap a new
 * fence is refused, and the caller keeps the operation uncertain instead of
 * fabricating a terminal rejection. Nothing here evicts an existing fence.
 */
import { json } from "./chat-internal.ts";
import type { ChatSqlStorage } from "./chat-ledger.ts";
import { MAX_SKILL_NO_ADMISSIONS } from "./skills-model.ts";

export type NoAdmissionRecord = {
  readonly operationId: string;
  readonly logicalOperationId: string;
  readonly message: string;
  readonly createdAt: number;
};

export type NoAdmissionRecordResult = "recorded" | "existing" | "full";

type Row = {
  operation_id: string;
  logical_operation_id: string;
  message: string;
  created_at: number;
};

export class ChatSkillsNoAdmissions {
  private readonly db: ChatSqlStorage;
  constructor(db: ChatSqlStorage) {
    this.db = db;
    db.exec(`CREATE TABLE IF NOT EXISTS skill_no_admissions (
      operation_id TEXT PRIMARY KEY, logical_operation_id TEXT NOT NULL,
      message TEXT NOT NULL, created_at INTEGER NOT NULL)`);
  }

  find(operationId: string): NoAdmissionRecord | null {
    const row = this.db
      .exec<Row>(`SELECT * FROM skill_no_admissions WHERE operation_id = ? LIMIT 1`, operationId)
      .toArray()[0];
    if (row === undefined) return null;
    return {
      operationId: row.operation_id,
      logicalOperationId: row.logical_operation_id,
      message: row.message,
      createdAt: row.created_at,
    };
  }

  record(
    operationId: string,
    logicalOperationId: string,
    message: string,
    now: number,
  ): NoAdmissionRecordResult {
    if (this.find(operationId) !== null) return "existing";
    const count =
      this.db.exec<{ n: number }>(`SELECT COUNT(*) AS n FROM skill_no_admissions`).toArray()[0]
        ?.n ?? 0;
    if (count >= MAX_SKILL_NO_ADMISSIONS) return "full";
    try {
      this.db.exec(
        `INSERT INTO skill_no_admissions (operation_id, logical_operation_id, message, created_at)
         VALUES (?, ?, ?, ?)`,
        operationId,
        logicalOperationId,
        message,
        now,
      );
      return "recorded";
    } catch {
      return this.find(operationId) === null ? "full" : "existing";
    }
  }
}

export const noAdmissionBody = (record: NoAdmissionRecord): unknown => ({
  operationId: record.operationId,
  logicalOperationId: record.logicalOperationId,
  terminal: true,
  code: "skills_not_admitted",
  message: record.message,
});

/** Terminal reply for an already fenced operation, before any execution. */
export const fencedNoAdmission = (
  fence: ChatSkillsNoAdmissions,
  operationId: string,
): Response | null => {
  const existing = fence.find(operationId);
  return existing === null ? null : json(noAdmissionBody(existing), 409);
};

/**
 * Terminal reply when the exact operation is definitely not admitted. Returns
 * null when the fence cannot be persisted, so callers keep uncertainty.
 */
export const recordNoAdmission = (
  fence: ChatSkillsNoAdmissions,
  operationId: string,
  logicalOperationId: string,
  message: string,
): Response | null => {
  const bounded = message.slice(0, 256);
  const result = fence.record(operationId, logicalOperationId, bounded, Date.now());
  if (result === "full") return null;
  const recorded = fence.find(operationId);
  return recorded === null ? null : json(noAdmissionBody(recorded), 409);
};

/**
 * Terminal creation only behind an explicit exact native-input absence proof.
 * A lookup error, any existing/queued input, or a failed proof keeps uncertainty.
 */
export const recordProvenNoAdmission = async (
  fence: ChatSkillsNoAdmissions,
  nativeInputAbsent: () => Promise<boolean>,
  operationId: string,
  logicalOperationId: string,
  message: string,
): Promise<Response | null> => {
  let absent = false;
  try {
    absent = await nativeInputAbsent();
  } catch {
    return null;
  }
  return absent ? recordNoAdmission(fence, operationId, logicalOperationId, message) : null;
};

/** Exact scoped input absence; a lookup error is not proof of absence. */
export const skillNativeInputAbsent = async (
  runtime: { inputRecord: (operationId: string) => Promise<unknown> },
  operationId: string,
): Promise<boolean> => {
  try {
    return (await runtime.inputRecord(operationId)) === undefined;
  } catch {
    return false;
  }
};

/** Terminal decision for a definite New Send refusal, behind the exact proof. */
export const fenceAdmissionDecision = async (
  fence: ChatSkillsNoAdmissions,
  nativeInputAbsent: () => Promise<boolean>,
  submission: {
    readonly operationId: string;
    readonly logicalOperationId: string;
    readonly fenceNoAdmission: boolean;
  },
  reason: string,
): Promise<Response | null> => {
  if (!submission.fenceNoAdmission || (reason !== "mismatch" && reason !== "archived")) return null;
  return recordProvenNoAdmission(
    fence,
    nativeInputAbsent,
    submission.operationId,
    submission.logicalOperationId,
    reason === "mismatch"
      ? "This operation was already used for different content."
      : "This chat is archived; the operation was not admitted.",
  );
};
