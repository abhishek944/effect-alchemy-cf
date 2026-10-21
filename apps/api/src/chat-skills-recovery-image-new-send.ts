import type { UserInput } from "@earendil-works/pi-durable";
import type { SkillAttempts, SkillAttemptDeps } from "./chat-skills-attempts.ts";
import { renderSkillCatalog, textDigest } from "./chat-skills-document.ts";
import {
  SKILLS_UNAVAILABLE,
  SkillRuntimeError,
  translateSkillError,
} from "./chat-skills-errors.ts";
import { loadSkillLibrary } from "./chat-skills-library.ts";
import {
  matchingCompactRecoveryContent,
  storeCompactRecoveryContent,
  verifiedRecoveryContent,
} from "./chat-skills-recovery-image-input.ts";

export type SkillNewSendPreparation = {
  readonly ownerId: string;
  readonly attemptId: string;
  readonly sourceLogicalOperationId: string;
  readonly sourceAttemptId: string;
  readonly content: UserInput;
};
export async function prepareSkillImageNewSend(
  attempts: SkillAttempts,
  deps: SkillAttemptDeps,
  input: SkillNewSendPreparation,
): Promise<UserInput> {
  const source = deps.store.byId(input.sourceAttemptId);
  // Guidance health is separate from input authority: a corrupt/old guidance
  // row is fine when the source identity and frozen content are exact, because
  // the new attempt uses the fresh current pin and an empty active list.
  if (
    source === null ||
    source.logicalOperationId !== input.sourceLogicalOperationId ||
    source.content === null
  )
    throw new SkillRuntimeError("invalid", "The original message is not available.");
  const existing = deps.store.byOperation(input.attemptId);
  if (existing !== null) {
    if (
      existing.attemptId !== input.attemptId ||
      existing.logicalOperationId !== input.attemptId ||
      existing.retryOf !== null ||
      existing.retryKey !== null ||
      existing.content === null
    )
      throw new SkillRuntimeError("invalid", "This operation already has a different attempt.");
    const content = await matchingCompactRecoveryContent(existing.content, input.content);
    await attempts.reinstall(existing.attemptId, input.ownerId);
    return content;
  }
  try {
    const stored = await storeCompactRecoveryContent(input.content);
    const librarySource = deps.library();
    if (librarySource === null) throw new SkillRuntimeError("unavailable", SKILLS_UNAVAILABLE);
    const library = await loadSkillLibrary(librarySource, input.ownerId);
    const catalog = renderSkillCatalog(library.documents);
    const active: [] = [];
    const outcome = deps.store.insert({
      attemptId: input.attemptId,
      operationId: input.attemptId,
      logicalOperationId: input.attemptId,
      retryOf: null,
      retryKey: null,
      pin: library.manifest,
      catalog,
      catalogDigest: await textDigest(catalog),
      active,
      content: stored,
      now: deps.now?.() ?? Date.now(),
    });
    if (outcome === "conflict")
      throw new SkillRuntimeError("invalid", "This operation already has a different attempt.");
    if (outcome === "existing") await attempts.reinstall(input.attemptId, input.ownerId);
    else
      await attempts.install(input.attemptId, library.documents, catalog, library.manifest.digest);
    return verifiedRecoveryContent(stored);
  } catch (error) {
    throw translateSkillError(error);
  }
}
