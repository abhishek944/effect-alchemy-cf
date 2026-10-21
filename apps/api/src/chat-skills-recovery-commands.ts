import { resolveChatSelectionValue } from "./chat-capability-policy.ts";
import { digestText, json } from "./chat-internal.ts";
import { INFERENCE_UNCONFIGURED } from "./chat-model.ts";
import { SKILLS_UNRECOVERABLE, SkillRuntimeError } from "./chat-skills-errors.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import type { SkillRetryRequest } from "./skills-model.ts";
import type { RecoveryRunner } from "./chat-skills-recovery.ts";
import { acceptedRecoveryImageInput } from "./chat-skills-recovery-image-native.ts";
import {
  sameRecoveryContent,
  verifiedRecoveryContent,
} from "./chat-skills-recovery-image-input.ts";
import {
  prepareRecoveryImageContent,
  recoveryCaption,
  recoveryFilesCompatible,
} from "./chat-skills-recovery-image-preparation.ts";
export { newSendCommand } from "./chat-skills-recovery-image-new-send-command.ts";

export const retryCommand = async (
  runner: RecoveryRunner,
  body: typeof SkillRetryRequest.Type,
  scope: ChatSendScope,
): Promise<Response> => {
  if (!runner.enter()) return json({ message: "Chat is busy" }, 409);
  const { deps } = runner;
  try {
    const metadata = deps.records.metadata(body.failedAttemptId);
    const prior = deps.store.byOperation(body.failedAttemptId);
    if (
      prior === null ||
      prior.logicalOperationId !== body.logicalOperationId ||
      (metadata !== null && metadata.files.some((file) => file.chatId !== scope.chat.id))
    )
      throw new SkillRuntimeError("invalid", "That failed answer is not available.");
    // The one canonical nonreleased successor always wins: a released requested
    // slot must never be resurrected once another successor was claimed. A key
    // that names another predecessor is rejected outright.
    const canonical = deps.store.bySuccessor(prior.attemptId);
    const requested = deps.store.byRetry(body.logicalOperationId, body.retryKey);
    if (requested !== null && requested.retryOf !== prior.attemptId)
      throw new SkillRuntimeError("invalid", "That retry key belongs to another attempt.");
    const successor = canonical ?? requested;
    if (successor !== null && successor.attemptId !== successor.operationId)
      throw new SkillRuntimeError("invalid", "That retry key belongs to another attempt.");
    // Accepted delivery repair comes before reloading damaged guidance, stage
    // eligibility or old-parent health: an exact native receipt means accepted,
    // not that its answer succeeded, and it must never execute again.
    if (successor !== null) {
      const storedIdentity = deps.records.identity(successor.operationId);
      if (storedIdentity !== null) {
        const repaired = await acceptedRecoveryImageInput(
          runner,
          { ownerId: scope.ownerId, chatId: scope.chat.id },
          successor.operationId,
          body.logicalOperationId,
          storedIdentity,
        );
        if (repaired !== null) return repaired;
      }
      if (successor.status === "incomplete" || successor.status === "unavailable")
        throw new SkillRuntimeError("invalid", "This retry is already being processed.");
    }
    const unrecoverable =
      prior.recoverable === false
        ? prior
        : successor !== null && successor.recoverable === false
          ? successor
          : null;
    if (unrecoverable !== null) {
      deps.notify();
      return json(
        {
          message: unrecoverable.recoveryReason ?? SKILLS_UNRECOVERABLE,
          code: "skills_unrecoverable",
        },
        409,
      );
    }
    if (metadata === null || prior.corrupt)
      throw new SkillRuntimeError("invalid", "That failed answer is not available.");
    const retryKey = successor?.retryKey ?? body.retryKey;
    const identity = await digestText(
      JSON.stringify({
        retry: body.logicalOperationId,
        failed: body.failedAttemptId,
        key: retryKey,
        selection: metadata.selection,
      }),
    );
    const existing = successor;
    const operationId = existing?.operationId ?? crypto.randomUUID();
    const known = deps.records.identity(operationId);
    if (known !== null && known !== identity)
      throw new SkillRuntimeError(
        "invalid",
        "This operation was already used for different content.",
      );
    const accepted = await acceptedRecoveryImageInput(
      runner,
      { ownerId: scope.ownerId, chatId: scope.chat.id },
      operationId,
      body.logicalOperationId,
      identity,
    );
    if (accepted !== null) return accepted;
    if (existing === null) {
      if (prior.status !== "incomplete" && prior.status !== "unavailable")
        throw new SkillRuntimeError(
          "invalid",
          "Only a failed original-version answer can be retried.",
        );
      if (prior.pin === null || prior.content === null)
        throw new SkillRuntimeError("unrecoverable", "The original skill version is unavailable.");
    }
    if (scope.chat.archived)
      return json({ message: "This chat is archived.", code: "archived" }, 409);
    if (!deps.enabled)
      return json({ message: INFERENCE_UNCONFIGURED, code: "inference_unconfigured" }, 503);
    const resolved = resolveChatSelectionValue(deps.policy, metadata.selection);
    if (!resolved.ok)
      return json(
        { message: "This original model or effort is no longer enabled.", code: resolved.code },
        400,
      );
    if (!recoveryFilesCompatible(metadata.files, metadata.selection.model))
      return json({ message: "The original attachments cannot run on their original model." }, 400);
    const busy = await runner.busy();
    if (busy !== null) return busy;
    const raw = existing === null ? prior.content : existing.content;
    if (raw === null)
      throw new SkillRuntimeError("unrecoverable", "The original message is unavailable.");
    const compact = await prepareRecoveryImageContent(deps, {
      kind: "retry",
      scope,
      operationId,
      logicalOperationId: body.logicalOperationId,
      identityHash: identity,
      sourceAttemptId: prior.attemptId,
      sourceLogicalOperationId: prior.logicalOperationId,
      selection: metadata.selection,
      content: verifiedRecoveryContent(raw),
      reused: existing !== null,
      retryKey,
    });
    if (recoveryCaption(compact, metadata.textLength) === null)
      throw new SkillRuntimeError("invalid", "The original message state is inconsistent.");
    const prepared = await deps.skills.prepareRetry({
      ownerId: scope.ownerId,
      attemptId: operationId,
      logicalOperationId: body.logicalOperationId,
      failedAttemptId: body.failedAttemptId,
      retryKey,
      content: compact,
    });
    if (prepared.attemptId !== operationId || !sameRecoveryContent(prepared.content, compact))
      throw new SkillRuntimeError("invalid", "The retry content is inconsistent.");
    if (
      !deps.records.bind(
        operationId,
        identity,
        { selection: metadata.selection, textLength: metadata.textLength, files: metadata.files },
        deps.records.account(body.failedAttemptId) ?? undefined,
        body.logicalOperationId,
      )
    )
      return json({ message: "This retry is already being processed." }, 409);
    const raced = await acceptedRecoveryImageInput(
      runner,
      { ownerId: scope.ownerId, chatId: scope.chat.id },
      operationId,
      body.logicalOperationId,
      identity,
    );
    if (raced !== null) return raced;
    return await runner.submit({
      operationId,
      logicalOperationId: body.logicalOperationId,
      ownerId: scope.ownerId,
      chatId: scope.chat.id,
      identity,
      selection: metadata.selection,
      content: prepared.content,
      fenceNoAdmission: false,
    });
  } catch (error) {
    if (error instanceof SkillRuntimeError) {
      if (error.code === "invalid") return json({ message: error.message }, 400);
      if (error.code === "unrecoverable")
        return json({ message: error.message, code: "skills_unrecoverable" }, 409);
      return json({ message: error.message, code: "skills_unavailable" }, 503);
    }
    return json(
      { message: "That answer could not be retried.", code: "skills_unrecoverable" },
      409,
    );
  } finally {
    runner.leave();
  }
};
