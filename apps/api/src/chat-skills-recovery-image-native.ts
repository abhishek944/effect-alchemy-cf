import type { UserInput } from "@earendil-works/pi-durable";
import { UserEntry } from "@earendil-works/pi-durable";
import { reportFailure } from "@starter/diagnostics";
import type { RecoveryRunner } from "./chat-skills-recovery.ts";
import { PI_BACKGROUND } from "./chat-runtime.ts";
import { json } from "./chat-internal.ts";
import { SUBMISSION_FAILED } from "./chat-model.ts";
import { SkillRuntimeError } from "./chat-skills-errors.ts";
import {
  sameRecoveryContent,
  verifiedRecoveryContent,
} from "./chat-skills-recovery-image-input.ts";

/** A local prepared row or queued/unplaced submission is not exact accepted input proof. */
export async function acceptedRecoveryImageInput(
  runner: RecoveryRunner,
  scope: { readonly ownerId: string; readonly chatId: string },
  operationId: string,
  logicalOperationId: string,
  identityHash: string,
): Promise<Response | null> {
  const { deps } = runner;
  const native = await deps.runtime.inputRecord(operationId);
  const row = deps.store.byOperation(operationId);
  if (native === undefined) {
    if (row !== null && !["prepared", "released"].includes(row.status))
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    return null;
  }
  // Guidance health is independent of accepted-input proof: corrupt pin/active
  // state must not block repair when the native identity and frozen content can
  // still be proven. Identity fields and content are validated below.
  if (
    deps.records.identity(operationId) !== identityHash ||
    row === null ||
    row.operationId !== operationId ||
    row.logicalOperationId !== logicalOperationId ||
    row.content === null
  )
    throw new SkillRuntimeError("invalid", "The accepted attempt identity is unavailable.");
  if (native.status === "queued" || native.entry === undefined)
    return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
  const conversationId = await deps.runtime.conversationId();
  const storage = await deps.runtime.storage();
  const visible = await storage.entry(native.conversationId, native.entry, PI_BACKGROUND);
  const entry = visible?.entry;
  const message = entry?.model?.[0];
  if (
    native.requestId !== operationId ||
    native.conversationId !== conversationId ||
    !UserEntry.is(entry) ||
    entry.conversationId !== conversationId ||
    entry.id !== native.entry ||
    entry.model?.length !== 1 ||
    message?.role !== "user" ||
    !Number.isFinite(message.timestamp) ||
    message.timestamp < 0 ||
    !sameRecoveryContent(verifiedRecoveryContent(row.content), message.content)
  )
    throw new SkillRuntimeError("invalid", "The accepted attempt content could not be verified.");
  deps.skills.accept(operationId);
  deps.ledger.accepted(operationId, Date.now());
  deps.ledger.recordEntry(operationId, native.entry, Date.now());
  try {
    await deps.finalize(operationId, scope.chatId, scope.ownerId);
  } catch (error) {
    // Exact native proof remains available for lost catalog-finalize repair.
    reportFailure(error, {
      component: "chat-skills-recovery",
      operation: "image-finalize",
      operationId,
      event: "application.recovery",
    });
  }
  return runner.accepted(operationId, logicalOperationId, true);
}

/**
 * Independently proven accepted native input for an attempt whose skills row is
 * lost: the exact user entry content, only when the request id, conversation,
 * entry identity and single user message all match. Returns null rather than
 * guessing when any proof is missing.
 */
export async function readAcceptedRecoveryContent(
  runner: RecoveryRunner,
  operationId: string,
): Promise<UserInput | null> {
  const { deps } = runner;
  const native = await deps.runtime.inputRecord(operationId);
  if (native === undefined || native.status === "queued" || native.entry === undefined) return null;
  const conversationId = await deps.runtime.conversationId();
  const storage = await deps.runtime.storage();
  const entry = (await storage.entry(native.conversationId, native.entry, PI_BACKGROUND))?.entry;
  const message = entry?.model?.[0];
  if (
    native.requestId !== operationId ||
    native.conversationId !== conversationId ||
    !UserEntry.is(entry) ||
    entry.conversationId !== conversationId ||
    entry.id !== native.entry ||
    entry.model?.length !== 1 ||
    message?.role !== "user"
  )
    return null;
  return message.content;
}
