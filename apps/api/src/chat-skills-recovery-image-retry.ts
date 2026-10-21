import type { UserInput } from "@earendil-works/pi-durable";
import type { SkillAttempts, SkillAttemptDeps, PreparedSkillSend } from "./chat-skills-attempts.ts";
import { textDigest } from "./chat-skills-document.ts";
import {
  SKILLS_UNAVAILABLE,
  SKILLS_UNRECOVERABLE,
  SkillRuntimeError,
  translateSkillError,
} from "./chat-skills-errors.ts";
import { loadPinnedLibrary } from "./chat-skills-pin.ts";
import {
  matchingCompactRecoveryContent,
  storeCompactRecoveryContent,
  verifiedRecoveryContent,
} from "./chat-skills-recovery-image-input.ts";

export type SkillRetryPreparation = {
  readonly ownerId: string;
  readonly attemptId: string;
  readonly logicalOperationId: string;
  readonly failedAttemptId: string;
  readonly retryKey: string;
  readonly content: UserInput;
};
export async function prepareSkillImageRetry(
  attempts: SkillAttempts,
  deps: SkillAttemptDeps,
  input: SkillRetryPreparation,
): Promise<PreparedSkillSend> {
  const prior = deps.store.byOperation(input.failedAttemptId);
  if (prior === null || prior.corrupt || prior.logicalOperationId !== input.logicalOperationId)
    throw new SkillRuntimeError("invalid", "That failed answer is not available to retry.");
  const existing = deps.store.byRetry(input.logicalOperationId, input.retryKey);
  if (existing !== null) {
    if (
      existing.corrupt ||
      existing.retryOf !== prior.attemptId ||
      existing.retryKey !== input.retryKey ||
      existing.attemptId !== input.attemptId ||
      existing.operationId !== input.attemptId
    )
      throw new SkillRuntimeError("invalid", "That retry key belongs to another attempt.");
    if (existing.content === null)
      throw new SkillRuntimeError("unrecoverable", SKILLS_UNRECOVERABLE);
    const content = await matchingCompactRecoveryContent(existing.content, input.content);
    await attempts.reinstall(existing.attemptId, input.ownerId);
    return { content, attemptId: existing.attemptId, duplicate: true };
  }
  if (deps.store.bySuccessor(prior.attemptId) !== null)
    throw new SkillRuntimeError("invalid", "This retry is already being processed.");
  if (prior.status !== "incomplete" && prior.status !== "unavailable")
    throw new SkillRuntimeError("invalid", "Only a failed original-version answer can be retried.");
  if (prior.pin === null || prior.content === null)
    throw new SkillRuntimeError("unrecoverable", SKILLS_UNRECOVERABLE);
  try {
    const stored = await storeCompactRecoveryContent(input.content);
    const source = deps.library();
    if (source === null) throw new SkillRuntimeError("unavailable", SKILLS_UNAVAILABLE);
    const loaded = await loadPinnedLibrary(
      source,
      input.ownerId,
      prior.pin,
      prior.active,
      prior.catalog,
    );
    const catalog = loaded.catalog;
    const outcome = deps.store.insert({
      attemptId: input.attemptId,
      operationId: input.attemptId,
      logicalOperationId: input.logicalOperationId,
      retryOf: prior.attemptId,
      retryKey: input.retryKey,
      pin: prior.pin,
      catalog,
      catalogDigest: prior.catalogDigest ?? (await textDigest(catalog)),
      active: loaded.active,
      content: stored,
      now: deps.now?.() ?? Date.now(),
    });
    if (outcome === "conflict")
      throw new SkillRuntimeError("invalid", "This retry is already being processed.");
    if (outcome === "existing") await attempts.reinstall(input.attemptId, input.ownerId);
    else
      await attempts.install(input.attemptId, loaded.library.documents, catalog, prior.pin.digest);
    return {
      content: verifiedRecoveryContent(stored),
      attemptId: input.attemptId,
      duplicate: outcome === "existing",
    };
  } catch (error) {
    if (error instanceof SkillRuntimeError && error.code === "integrity") {
      deps.store.setRecoverability(prior.attemptId, false, SKILLS_UNRECOVERABLE);
      deps.notify();
      throw new SkillRuntimeError("unrecoverable", SKILLS_UNRECOVERABLE);
    }
    throw translateSkillError(error);
  }
}
