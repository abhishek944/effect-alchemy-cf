import type { Api, Context, Model } from "@earendil-works/pi-ai";
import type { Harness, Registry, TaskId, UserInput } from "@earendil-works/pi-durable";
import type { ChatRuntime } from "./chat-runtime.ts";
import { recoverSkillsBeforeResume, type SkillBootResult } from "./chat-skills-boot.ts";
import { failSkillAttempt } from "./chat-skills-defect.ts";
import { reportSkillRecovery, SKILLS_PINNED_UNAVAILABLE } from "./chat-skills-errors.ts";
import { SkillAttempts, type PreparedSkillSend } from "./chat-skills-attempts.ts";
import { canonicalSkillContext, type GuardedRequest } from "./chat-skills-guard.ts";
import {
  assertSkillDispatchAllowed,
  pruneSkillLatch,
  skillDispatchBlocked,
} from "./chat-skills-dispatch-gate.ts";
import { skillNativeInputAbsent } from "./chat-skills-no-admission.ts";
import { currentSkillProjection, type SkillProjectionState } from "./chat-skills-projection.ts";
import { prepareSkillRequestFor } from "./chat-skills-request.ts";
import { skillSummaryHealth, type SummaryHealth } from "./chat-skills-summary.ts";
import type { PiContext } from "./chat-projection.ts";
import type { SendEra } from "./chat-send-records.ts";
import type { SkillLibrarySource } from "./chat-skills-library.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";

export {
  SKILLS_INTEGRITY,
  SKILLS_UNAVAILABLE,
  SKILLS_UNRECOVERABLE,
  SkillRuntimeError,
} from "./chat-skills-errors.ts";
export type ConversationSkillsOptions = {
  readonly store: ChatSkillsStore;
  readonly registry: () => Registry | null;
  readonly runtime: () => ChatRuntime;
  readonly owner: () => string | null;
  readonly scope: () => string | null;
  readonly sendEra: (operationId: string) => SendEra;
  readonly logicalOperation: (operationId: string) => string | null;
  readonly library: () => SkillLibrarySource | null;
  readonly notify: () => void;
  readonly now?: () => number;
};
export class ConversationSkills {
  private readonly options: ConversationSkillsOptions;
  private readonly latched = new Map<string, string>();
  private readonly attempts: SkillAttempts;
  constructor(options: ConversationSkillsOptions) {
    this.options = options;
    this.attempts = new SkillAttempts({
      store: options.store,
      library: options.library,
      registry: options.registry,
      defect: (attemptId, message, taskId, permanent) =>
        this.defect(attemptId, message, taskId, permanent),
      notify: options.notify,
      now: options.now,
    });
  }
  private readonly now = (): number => this.options.now?.() ?? Date.now();
  private fail(operationId: string, message: string): void {
    this.latched.set(operationId, message);
    pruneSkillLatch(this.options.store, this.latched);
    this.persist(operationId, "skills_latch_persist_failed", () =>
      this.options.store.incomplete(operationId, message),
    );
    this.persist(operationId, "skills_notify_failed", this.options.notify);
  }
  private persist(operationId: string, reason: string, run: () => void): void {
    try {
      run();
    } catch (error) {
      reportSkillRecovery(error, "defect.persist", reason, operationId);
    }
  }
  private defect(
    attemptId: string,
    message: string,
    currentTaskId: TaskId | undefined,
    permanent: boolean | undefined,
  ): Promise<void> {
    return failSkillAttempt(
      {
        store: this.options.store,
        latch: (operationId, detail) => this.latched.set(operationId, detail),
        notify: this.options.notify,
        harness: () => this.options.runtime().pi(),
      },
      attemptId,
      message,
      currentTaskId,
      permanent,
    );
  }
  prepareNew = (input: Parameters<SkillAttempts["prepareNew"]>[0]): Promise<void> =>
    this.attempts.prepareNew(input);
  prepareRetry = (
    input: Parameters<SkillAttempts["prepareRetry"]>[0],
  ): Promise<PreparedSkillSend> => this.attempts.prepareRetry(input);
  prepareNewSend = (input: Parameters<SkillAttempts["prepareNewSend"]>[0]): Promise<UserInput> =>
    this.attempts.prepareNewSend(input);
  nativeInputAbsent = (operationId: string): Promise<boolean> =>
    skillNativeInputAbsent(this.options.runtime(), operationId);
  dispatchBlocked = (operationId: string): string | null =>
    skillDispatchBlocked(this.options.store, this.options.sendEra, this.latched, operationId);
  assertDispatchAllowed(operationId: string): Promise<void> {
    return assertSkillDispatchAllowed(
      {
        store: this.options.store,
        scope: this.options.scope,
        sendEra: this.options.sendEra,
        fail: (operation, detail) => this.fail(operation, detail),
      },
      this.latched,
      operationId,
    );
  }
  accept(operationId: string): boolean {
    const accepted = this.options.store.accept(operationId);
    this.options.notify();
    return accepted;
  }
  release(operationId: string): boolean {
    const released = this.options.store.release(operationId);
    if (released) this.latched.delete(operationId);
    return released;
  }
  recoverBeforeResumeOn(harness: Harness, context: PiContext): Promise<SkillBootResult> {
    return recoverSkillsBeforeResume(
      {
        store: this.options.store,
        attempts: this.attempts,
        owner: () => this.options.owner(),
        scope: () => this.options.scope(),
        library: () => this.options.library(),
        sendEra: (operationId) => this.options.sendEra(operationId),
        logicalOperation: (operationId) => this.options.logicalOperation(operationId),
        latch: (operationId, message) => this.latched.set(operationId, message),
        notify: this.options.notify,
        now: () => this.now(),
      },
      harness,
      context,
    );
  }
  async prepareRequest(
    model: Model<Api>,
    context: Context,
    signal?: AbortSignal,
  ): Promise<GuardedRequest> {
    const live = await this.options.runtime().liveInput();
    if (!live.run)
      return { ok: true, context: canonicalSkillContext(context, null, null, this.now()) };
    if (live.operationId === null) return { ok: false, message: SKILLS_PINNED_UNAVAILABLE };
    return this.prepareRequestFor(live.operationId, model, context, signal);
  }
  prepareRequestFor(
    operationId: string,
    model: Model<Api>,
    context: Context,
    signal?: AbortSignal,
  ): Promise<GuardedRequest> {
    return prepareSkillRequestFor(
      {
        store: this.options.store,
        scope: this.options.scope,
        sendEra: this.options.sendEra,
        logicalOperation: this.options.logicalOperation,
        notify: this.options.notify,
        latched: this.latched,
        fail: (operation, message) => this.fail(operation, message),
        now: this.now(),
      },
      operationId,
      model,
      context,
      signal,
    );
  }
  projectionSections(): Promise<SkillProjectionState> {
    return currentSkillProjection(this.options.store, this.options.scope, () =>
      this.options.runtime().liveInput(),
    );
  }
  scopeLiveOperation = async (): Promise<string | null> =>
    (await this.options.runtime().liveInput()).operationId;
  failForOperation(operationId: string | null, message: string): void {
    if (operationId === null || this.options.store.byOperation(operationId) === null) return;
    this.fail(operationId, message);
  }
  summaryHealth(): Promise<SummaryHealth> {
    return skillSummaryHealth({
      store: this.options.store,
      scope: this.options.scope,
      sendEra: this.options.sendEra,
      logicalOperation: this.options.logicalOperation,
      latched: this.latched,
      fail: (operationId, message) => this.fail(operationId, message),
      live: () => this.options.runtime().liveInput(),
    });
  }
}
