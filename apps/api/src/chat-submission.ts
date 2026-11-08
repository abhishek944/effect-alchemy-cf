import type { AccountOperationRecord } from "./chat-account-operations.ts";
import { resolveChatSelectionValue } from "./chat-capability-policy.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import type { StageModelPolicy } from "./chat-capability-policy.ts";
import { digestText, json } from "./chat-internal.ts";
import {
  ChatInvalid,
  INFERENCE_UNCONFIGURED,
  SUBMISSION_FAILED,
  type SendMessage,
} from "./chat-model.ts";
import { reportSendFailure } from "./chat-observation.ts";
import { SkillRuntimeError } from "./chat-skills-errors.ts";
import { sendIdentity } from "./chat-send-identity.ts";
import type { ChatAdmissionFence } from "./chat-admission-fence.ts";
import { fencedNoAdmission, type ChatSkillsNoAdmissions } from "./chat-skills-no-admission.ts";
import type { ChatRuntime } from "./chat-runtime.ts";
import type { PreparedSkills, ChatSdkSkills } from "./chat-sdk-skills.ts";
import type {
  ChatSendScope,
  PreparedChatSend,
  SendObservation,
  SendProgress,
} from "./chat-submission-types.ts";
export type { ChatSendScope, PreparedChatSend } from "./chat-submission-types.ts";

type Prepared = PreparedChatSend & {
  readonly accept: (entry: number) => Promise<void>;
  readonly release: () => Promise<void>;
};
type Options = {
  readonly runtime: ChatRuntime;
  readonly fence: ChatAdmissionFence;
  readonly noAdmissions: ChatSkillsNoAdmissions;
  readonly enabled: boolean;
  readonly policy: StageModelPolicy;
  readonly skills: ChatSdkSkills;
  readonly prepare: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    model: ChatCatalogModel,
  ) => Promise<Prepared>;
  readonly prepareAccount: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
  ) => Promise<AccountOperationRecord | null>;
  readonly retainAccepted: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    entry: number | undefined,
  ) => Promise<void>;
  readonly dispatch: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    entry: number,
    skills: PreparedSkills,
  ) => void;
};

/** A concurrent Send is rejected; only the Node Pi SDK executes accepted work. */
export class ChatSubmission {
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }
  async send(
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    request: SendObservation,
  ): Promise<Response> {
    if (!this.options.fence.tryEnter()) return json({ message: "Chat is busy" }, 409);
    const progress: SendProgress = { phase: "identity", outcome: "not-submitted" };
    let prepared: Prepared | undefined;
    let skills: PreparedSkills | undefined;
    try {
      const { runtime } = this.options;
      const hash = await digestText(sendIdentity(input));
      const known = runtime.sends.identity(input.operationId);
      if (known !== null && known !== hash)
        return json({ message: "Operation identity does not match this message." }, 400);
      const accepted = await runtime.inputRecord(input.operationId);
      if (accepted !== undefined) {
        if (known === null) return json({ message: "Operation identity is unavailable." }, 400);
        progress.outcome = "confirmed";
        await this.options.retainAccepted(input, scope, accepted.entry);
        return json({ accepted: true, duplicate: true });
      }
      const fenced = fencedNoAdmission(this.options.noAdmissions, input.operationId);
      if (fenced !== null) return fenced;
      if (!this.options.enabled)
        return json({ message: INFERENCE_UNCONFIGURED, code: "inference_unconfigured" }, 503);
      const resolved = resolveChatSelectionValue(this.options.policy, input.selection);
      if (!resolved.ok)
        return json(
          { message: "This model or effort is not enabled in this stage.", code: resolved.code },
          400,
        );
      if (!input.text && !input.attachments.length && !input.references?.length)
        return json({ message: "Write a message or attach a file." }, 400);
      if (runtime.active !== null) return json({ message: "Chat is busy" }, 409);
      progress.phase = "prepare";
      prepared = await this.options.prepare(input, scope, resolved.model);
      progress.phase = "skills-prepare";
      skills = await this.options.skills.prepare(scope.ownerId, input.operationId);
      const account = await this.options.prepareAccount(input, scope);
      if (
        !runtime.sends.bind(
          input.operationId,
          hash,
          {
            selection: input.selection,
            textLength: input.text.length,
            files: prepared.files,
          },
          account ?? undefined,
        )
      )
        throw new ChatInvalid({ message: "Operation identity does not match this message." });
      progress.phase = "accept";
      // Synchronous object-owned writes establish one immutable acceptance before work starts.
      runtime.ledger.tentative(input.operationId, Date.now());
      const content =
        typeof prepared.content === "string" ? prepared.content : [...prepared.content];
      const entry = runtime.transcript.append({ role: "user", content, timestamp: Date.now() });
      runtime.transcript.saveRun({
        operationId: input.operationId,
        entry: entry.id,
        runId: crypto.randomUUID(),
        status: "placed",
      });
      runtime.ledger.recordEntry(input.operationId, entry.id, Date.now());
      runtime.ledger.accepted(input.operationId, Date.now());
      progress.outcome = "confirmed";
      try {
        await prepared.accept(entry.id);
        this.options.dispatch(input, scope, entry.id, skills);
        skills = undefined; // The active run now owns this immutable snapshot.
      } catch (error) {
        const run = runtime.transcript.run(input.operationId);
        if (run !== null) runtime.transcript.saveRun({ ...run, status: "unanswered" });
        runtime.ledger.setStatus(input.operationId, "unanswered", Date.now());
        runtime.notify();
        throw error;
      }
      return json({ accepted: true });
    } catch (error) {
      if (progress.outcome !== "confirmed") await prepared?.release();
      if (error instanceof ChatInvalid) return json({ message: error.message }, 400);
      reportSendFailure(
        error,
        { ...request, operationId: input.operationId, chatId: scope.chat.id },
        progress,
        this.options.runtime.diagnostic,
      );
      return error instanceof SkillRuntimeError
        ? json({ message: error.message, code: "skills_unavailable" }, 503)
        : json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    } finally {
      skills?.release();
      this.options.fence.leave();
    }
  }
}
