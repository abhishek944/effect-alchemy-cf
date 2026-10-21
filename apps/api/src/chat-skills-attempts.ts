import type { Registry, TaskId, UserInput } from "@earendil-works/pi-durable";
import { renderSkillCatalog, textDigest, type SkillDocument } from "./chat-skills-document.ts";
import {
  SKILLS_UNAVAILABLE,
  SkillRuntimeError,
  translateSkillError,
} from "./chat-skills-errors.ts";
import { loadSkillLibrary, type SkillLibrarySource } from "./chat-skills-library.ts";
import { installAttemptExtension, reinstallAttemptExtension } from "./chat-skills-pin.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import {
  matchingCompactRecoveryContent,
  storeCompactRecoveryContent,
} from "./chat-skills-recovery-image-input.ts";
import {
  prepareSkillImageRetry,
  type SkillRetryPreparation,
} from "./chat-skills-recovery-image-retry.ts";
import {
  prepareSkillImageNewSend,
  type SkillNewSendPreparation,
} from "./chat-skills-recovery-image-new-send.ts";
export type SkillAttemptDeps = {
  readonly store: ChatSkillsStore;
  readonly library: () => SkillLibrarySource | null;
  readonly registry: () => Registry | null;
  readonly defect: (
    attemptId: string,
    message: string,
    taskId: TaskId | undefined,
    permanent?: boolean,
  ) => Promise<void>;
  readonly notify: () => void;
  readonly now?: (() => number) | undefined;
};
export type PreparedSkillSend = {
  readonly content: UserInput;
  readonly attemptId: string;
  readonly duplicate: boolean;
};
export class SkillAttempts {
  private readonly deps: SkillAttemptDeps;
  constructor(deps: SkillAttemptDeps) {
    this.deps = deps;
  }
  private source(): SkillLibrarySource {
    const source = this.deps.library();
    if (source === null) throw new SkillRuntimeError("unavailable", SKILLS_UNAVAILABLE);
    return source;
  }
  async install(
    attemptId: string,
    documents: readonly SkillDocument[],
    catalog: string,
    fingerprint: string,
  ): Promise<void> {
    await installAttemptExtension({
      store: this.deps.store,
      registry: this.deps.registry(),
      attemptId,
      documents,
      catalog,
      fingerprint,
      defect: (message, taskId, permanent) =>
        this.deps.defect(attemptId, message, taskId, permanent),
      notify: this.deps.notify,
    });
  }
  async reinstall(attemptId: string, ownerId: string): Promise<void> {
    await reinstallAttemptExtension({
      store: this.deps.store,
      source: this.source(),
      registry: this.deps.registry(),
      attemptId,
      ownerId,
      defect: (message, taskId, permanent) =>
        this.deps.defect(attemptId, message, taskId, permanent),
      notify: this.deps.notify,
    });
  }
  async prepareNew(input: {
    readonly ownerId: string;
    readonly attemptId: string;
    readonly content: UserInput;
  }): Promise<void> {
    try {
      const existing = this.deps.store.byOperation(input.attemptId);
      if (existing !== null) {
        if (
          existing.corrupt ||
          existing.attemptId !== input.attemptId ||
          existing.logicalOperationId !== input.attemptId ||
          existing.retryOf !== null ||
          existing.retryKey !== null ||
          existing.content === null
        )
          throw new SkillRuntimeError("invalid", "This operation already has a different attempt.");
        await matchingCompactRecoveryContent(existing.content, input.content);
        return await this.reinstall(input.attemptId, input.ownerId);
      }
      const stored = await storeCompactRecoveryContent(input.content);
      const library = await loadSkillLibrary(this.source(), input.ownerId);
      const catalog = renderSkillCatalog(library.documents);
      const outcome = this.deps.store.insert({
        attemptId: input.attemptId,
        operationId: input.attemptId,
        logicalOperationId: input.attemptId,
        retryOf: null,
        retryKey: null,
        pin: library.manifest,
        catalog,
        catalogDigest: await textDigest(catalog),
        active: [],
        content: stored,
        now: this.deps.now?.() ?? Date.now(),
      });
      if (outcome === "conflict")
        throw new SkillRuntimeError("invalid", "This operation already has a different attempt.");
      if (outcome === "existing") return await this.reinstall(input.attemptId, input.ownerId);
      await this.install(input.attemptId, library.documents, catalog, library.manifest.digest);
    } catch (error) {
      throw translateSkillError(error);
    }
  }
  prepareRetry(input: SkillRetryPreparation): Promise<PreparedSkillSend> {
    return prepareSkillImageRetry(this, this.deps, input);
  }
  prepareNewSend(input: SkillNewSendPreparation): Promise<UserInput> {
    return prepareSkillImageNewSend(this, this.deps, input);
  }
}
