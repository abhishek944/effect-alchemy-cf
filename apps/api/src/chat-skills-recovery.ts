/** Operation-scoped recovery: shared admission, native submit and DTO. */
import { ConversationBusy, type UserInput } from "@earendil-works/pi-durable";
import { ROOT_SESSION, type PiHarness, type PiSubmitOptions } from "agents/harness/pi";
import type { ChatAdmissionFence } from "./chat-admission-fence.ts";
import type { AccountOperationRecord } from "./chat-account-operations.ts";
import type { ChatSelection } from "./chat-capabilities.ts";
import type { StageModelPolicy } from "./chat-capability-policy.ts";
import { json } from "./chat-internal.ts";
import type { ChatLedger } from "./chat-ledger.ts";
import { SUBMISSION_FAILED } from "./chat-model.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import type { ChatSkillsStore } from "./chat-skills-store.ts";
import type { ConversationSkills } from "./chat-skills-runtime.ts";
import type { ChatSendScope } from "./chat-submission.ts";
import type { SkillNewSendRequest, SkillRetryRequest } from "./skills-model.ts";
import {
  fenceAdmissionDecision,
  fencedNoAdmission,
  type ChatSkillsNoAdmissions,
} from "./chat-skills-no-admission.ts";
import { newSendCommand, retryCommand } from "./chat-skills-recovery-commands.ts";
import { acceptedRecoveryImageInput } from "./chat-skills-recovery-image-native.ts";
import type { SkillRecoveryImageInput } from "./chat-skills-recovery-image-input.ts";
import type { SkillReadiness } from "./chat-skills-readiness.ts";
export type { SkillRecoveryImageInput } from "./chat-skills-recovery-image-input.ts";

export type ChatSkillsRecoveryDeps = {
  readonly harness: PiHarness;
  readonly runtime: ChatRuntime;
  readonly ledger: ChatLedger;
  readonly records: ChatSendRecords;
  readonly store: ChatSkillsStore;
  readonly skills: ConversationSkills;
  readonly policy: StageModelPolicy;
  readonly enabled: boolean;
  readonly fence: ChatAdmissionFence;
  readonly noAdmissions: ChatSkillsNoAdmissions;
  readonly notify: () => void;
  readonly readiness: () => Promise<SkillReadiness>;
  readonly prepareImages: (input: SkillRecoveryImageInput) => Promise<UserInput>;
  readonly prepareAccount: (
    input: { readonly text: string; readonly operationId: string },
    scope: ChatSendScope,
  ) => Promise<AccountOperationRecord | null>;
  readonly admit: (input: {
    readonly ownerId: string;
    readonly chatId: string;
    readonly operationId: string;
    readonly identity: string;
    readonly leaseId: string;
    readonly now: number;
  }) => Promise<{ readonly admitted: boolean; readonly reason: string } | null>;
  readonly releaseAdmission: (
    operationId: string,
    leaseId: string,
    ownerId: string,
  ) => Promise<void>;
  readonly finalize: (operationId: string, chatId: string, ownerId: string) => Promise<void>;
};

export type RecoverySubmission = {
  readonly operationId: string;
  readonly logicalOperationId: string;
  readonly fenceNoAdmission: boolean;
  readonly ownerId: string;
  readonly chatId: string;
  readonly identity: string;
  readonly selection: ChatSelection;
  readonly content: UserInput;
};

export type RecoveryRunner = {
  readonly deps: ChatSkillsRecoveryDeps;
  busy(): Promise<Response | null>;
  enter(): boolean;
  leave(): void;
  accepted(operationId: string, logicalOperationId: string, duplicate: boolean): Response;
  submit(input: RecoverySubmission): Promise<Response>;
};

export class ChatSkillsRecovery implements RecoveryRunner {
  readonly deps: ChatSkillsRecoveryDeps;
  constructor(deps: ChatSkillsRecoveryDeps) {
    this.deps = deps;
  }

  async busy(): Promise<Response | null> {
    await this.deps.runtime.pi();
    if (await this.deps.harness.session(ROOT_SESSION).busy())
      return json({ message: "Chat is busy" }, 409);
    return null;
  }

  enter(): boolean {
    return this.deps.fence.tryEnter();
  }

  leave(): void {
    this.deps.fence.leave();
  }

  accepted(operationId: string, logicalOperationId: string, duplicate: boolean): Response {
    return json({ accepted: true, duplicate, operationId, logicalOperationId });
  }

  readiness(): Promise<SkillReadiness> {
    return this.deps.readiness();
  }

  private async releaseAdmission(
    operationId: string,
    leaseId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      await this.deps.releaseAdmission(operationId, leaseId, ownerId);
    } catch {}
  }

  async submit(input: RecoverySubmission): Promise<Response> {
    const fenced = fencedNoAdmission(this.deps.noAdmissions, input.operationId);
    if (fenced !== null) return fenced;
    const { runtime, ledger } = this.deps;
    const leaseId = crypto.randomUUID();
    const decision = await this.deps.admit({
      ownerId: input.ownerId,
      chatId: input.chatId,
      operationId: input.operationId,
      identity: input.identity,
      leaseId,
      now: Date.now(),
    });
    if (decision === null) {
      this.deps.skills.release(input.operationId);
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
    if (!decision.admitted) {
      this.deps.skills.release(input.operationId);
      await this.releaseAdmission(input.operationId, leaseId, input.ownerId);
      const terminal = await fenceAdmissionDecision(
        this.deps.noAdmissions,
        () => this.deps.skills.nativeInputAbsent(input.operationId),
        input,
        decision.reason,
      );
      if (terminal !== null) return terminal;
      if (decision.reason === "mismatch")
        return json({ message: "This operation was already used for different content." }, 400);
      if (decision.reason === "archived")
        return json({ message: "This chat is archived.", code: "archived" }, 409);
      return json({ message: "Too many requests. Wait a moment and try again." }, 429);
    }
    const conversation = await runtime.conversation();
    await conversation.configure(
      {
        model: { provider: input.selection.provider, modelId: input.selection.model },
        thinkingLevel: input.selection.effort,
      },
      PI_BACKGROUND,
    );
    ledger.tentative(input.operationId, Date.now());
    const options: PiSubmitOptions = { operationId: input.operationId };
    Object.assign(options, { whenBusy: "reject" });
    try {
      const receipt = await this.deps.harness.session(ROOT_SESSION).submit(input.content, options);
      ledger.accepted(input.operationId, Date.now());
      const proof = await acceptedRecoveryImageInput(
        this,
        input,
        input.operationId,
        input.logicalOperationId,
        input.identity,
      );
      if (proof === null)
        return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
      return proof.ok
        ? this.accepted(input.operationId, input.logicalOperationId, !receipt.accepted)
        : proof;
    } catch (error) {
      if (error instanceof ConversationBusy) {
        this.deps.skills.release(input.operationId);
        await this.releaseAdmission(input.operationId, leaseId, input.ownerId);
        return json({ message: "Chat is busy" }, 409);
      }
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
  }

  retry(body: typeof SkillRetryRequest.Type, scope: ChatSendScope): Promise<Response> {
    return retryCommand(this, body, scope);
  }

  newSend(body: typeof SkillNewSendRequest.Type, scope: ChatSendScope): Promise<Response> {
    return newSendCommand(this, body, scope);
  }
}
