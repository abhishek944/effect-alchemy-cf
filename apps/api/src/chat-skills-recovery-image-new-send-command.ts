import type { UserInput } from "@earendil-works/pi-durable";
import { resolveChatSelectionValue } from "./chat-capability-policy.ts";
import { fencedNoAdmission, recordProvenNoAdmission } from "./chat-skills-no-admission.ts";
import { digestText, json } from "./chat-internal.ts";
import { INFERENCE_UNCONFIGURED } from "./chat-model.ts";
import { SkillRuntimeError } from "./chat-skills-errors.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import type { SkillNewSendRequest } from "./skills-model.ts";
import type { RecoveryRunner } from "./chat-skills-recovery.ts";
import {
  acceptedRecoveryImageInput,
  readAcceptedRecoveryContent,
} from "./chat-skills-recovery-image-native.ts";
import {
  sameRecoveryContent,
  verifiedRecoveryContent,
} from "./chat-skills-recovery-image-input.ts";
import {
  prepareRecoveryImageContent,
  recoveryCaption,
  recoveryFilesCompatible,
  sameRecoveryFiles,
} from "./chat-skills-recovery-image-preparation.ts";

export const newSendCommand = async (
  runner: RecoveryRunner,
  body: typeof SkillNewSendRequest.Type,
  scope: ChatSendScope,
): Promise<Response> => {
  if (!runner.enter()) return json({ message: "Chat is busy" }, 409);
  const { deps } = runner;
  const reject = (message: string): Promise<Response | null> =>
    recordProvenNoAdmission(
      deps.noAdmissions,
      () => deps.skills.nativeInputAbsent(body.operationId),
      body.operationId,
      body.operationId,
      message,
    );
  try {
    const identity = await digestText(
      JSON.stringify({
        send: body.operationId,
        source: body.sourceOperationId,
        sourceAttempt: body.sourceAttemptId,
        selection: body.selection,
      }),
    );
    const known = deps.records.identity(body.operationId);
    if (known !== null && known !== identity)
      return json({ message: "This operation was already used for different content." }, 400);
    // Exact C receipt first: an already accepted operation must be repaired even
    // when the older source row/metadata is damaged or missing. This never
    // weakens C proof: the helper still requires the stored identity, row ids,
    // frozen content and the accepted native entry.
    const existing = deps.store.byOperation(body.operationId);
    if (
      existing !== null &&
      (existing.attemptId !== body.operationId ||
        existing.logicalOperationId !== body.operationId ||
        existing.retryOf !== null ||
        existing.retryKey !== null)
    )
      throw new SkillRuntimeError("invalid", "This operation already has a different attempt.");
    if (existing !== null && existing.content !== null && known !== null) {
      const accepted = await acceptedRecoveryImageInput(
        runner,
        { ownerId: scope.ownerId, chatId: scope.chat.id },
        body.operationId,
        body.operationId,
        known,
      );
      if (accepted !== null) return accepted;
    }
    // Acceptance-first; only now may a recorded permanent fence forbid execution.
    const fenced = fencedNoAdmission(deps.noAdmissions, body.operationId);
    if (fenced !== null) return fenced;
    const source = deps.records.metadata(body.sourceOperationId);
    const sourceRow = deps.store.byId(body.sourceAttemptId);
    const sourceAttempt = sourceRow === null ? null : deps.records.metadata(sourceRow.operationId);
    // Guidance health is separate; the exact accepted source/content/caption decide.
    if (
      source === null ||
      sourceRow === null ||
      sourceAttempt === null ||
      sourceRow.logicalOperationId !== body.sourceOperationId ||
      source.textLength !== sourceAttempt.textLength ||
      !sameRecoveryFiles(source.files, sourceAttempt.files) ||
      source.files.some((file) => file.chatId !== scope.chat.id)
    )
      throw new SkillRuntimeError("invalid", "The original message is not available.");
    if (scope.chat.archived) {
      const terminal = await reject("This chat is archived; the operation was not admitted.");
      if (terminal !== null) return terminal;
      return json({ message: "This chat is archived.", code: "archived" }, 409);
    }
    if (!deps.enabled)
      return json({ message: INFERENCE_UNCONFIGURED, code: "inference_unconfigured" }, 503);
    const resolved = resolveChatSelectionValue(deps.policy, body.selection);
    if (!resolved.ok) {
      const terminal = await reject("This model or effort is not enabled in this stage.");
      if (terminal !== null) return terminal;
      return json(
        { message: "This model or effort is not enabled in this stage.", code: resolved.code },
        400,
      );
    }
    if (!recoveryFilesCompatible(source.files, body.selection.model)) {
      const terminal = await reject("The original attachments cannot run on this model.");
      if (terminal !== null) return terminal;
      return json({ message: "The original attachments cannot run on this model." }, 400);
    }
    const busy = await runner.busy();
    if (busy !== null) return busy;
    // A lost row's exact accepted native input, proven above, may be reused.
    let frozenInput: UserInput | null = null;
    if (existing !== null && existing.content !== null)
      frozenInput = verifiedRecoveryContent(existing.content);
    else if (sourceRow.content !== null) frozenInput = verifiedRecoveryContent(sourceRow.content);
    else frozenInput = await readAcceptedRecoveryContent(runner, sourceRow.operationId);
    if (frozenInput === null)
      throw new SkillRuntimeError(
        "invalid",
        "The original message could not be recovered from this chat; type a fresh message to continue with current skills.",
      );
    const compact = await prepareRecoveryImageContent(deps, {
      kind: "new-send",
      scope,
      operationId: body.operationId,
      logicalOperationId: body.operationId,
      identityHash: identity,
      sourceAttemptId: sourceRow.attemptId,
      sourceLogicalOperationId: sourceRow.logicalOperationId,
      selection: body.selection,
      content: frozenInput,
      reused: existing !== null,
      retryKey: null,
    });
    const caption = recoveryCaption(compact, source.textLength);
    if (caption === null)
      throw new SkillRuntimeError("invalid", "The original message state is inconsistent.");
    const content = await deps.skills.prepareNewSend({
      ownerId: scope.ownerId,
      attemptId: body.operationId,
      sourceLogicalOperationId: body.sourceOperationId,
      sourceAttemptId: sourceRow.attemptId,
      content: compact,
    });
    if (!sameRecoveryContent(content, compact))
      throw new SkillRuntimeError("invalid", "The new message content is inconsistent.");
    const account =
      known === null
        ? await deps.prepareAccount({ text: caption, operationId: body.operationId }, scope)
        : deps.records.account(body.operationId);
    if (
      !deps.records.bind(
        body.operationId,
        identity,
        { selection: body.selection, textLength: caption.length, files: source.files },
        account ?? undefined,
        body.operationId,
      )
    ) {
      deps.skills.release(body.operationId);
      return json({ message: "This operation was already used for different content." }, 400);
    }
    const raced = await acceptedRecoveryImageInput(
      runner,
      { ownerId: scope.ownerId, chatId: scope.chat.id },
      body.operationId,
      body.operationId,
      identity,
    );
    if (raced !== null) return raced;
    return await runner.submit({
      operationId: body.operationId,
      logicalOperationId: body.operationId,
      ownerId: scope.ownerId,
      chatId: scope.chat.id,
      identity,
      selection: body.selection,
      content: frozenInput,
      fenceNoAdmission: true,
    });
  } catch (error) {
    if (error instanceof SkillRuntimeError) {
      if (error.code === "invalid") {
        const terminal = await reject(error.message);
        if (terminal !== null) return terminal;
        // Existing/queued native input, an identity conflict or a lookup error
        // keeps the operation uncertain instead of fabricating a rejection.
        return json({ message: error.message, code: "skills_unavailable" }, 503);
      }
      return json({ message: error.message, code: "skills_unavailable" }, 503);
    }
    return json({ message: "The current skills could not be prepared." }, 400);
  } finally {
    runner.leave();
  }
};
