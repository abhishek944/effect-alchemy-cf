import { ConversationBusy } from "@earendil-works/pi-durable";
import { ROOT_SESSION, type PiSubmitOptions } from "agents/harness/pi";
import { resolveChatSelectionValue } from "./chat-capability-policy.ts";
import { digestText, json } from "./chat-internal.ts";
import { SkillRuntimeError } from "./chat-skills-errors.ts";
import { noAdmissionBody } from "./chat-skills-no-admission.ts";
import {
  ChatInvalid,
  INFERENCE_UNCONFIGURED,
  SUBMISSION_FAILED,
  type SendMessage,
} from "./chat-model.ts";
import { PI_BACKGROUND } from "./chat-runtime.ts";
import { sendIdentity } from "./chat-send-identity.ts";
import type { ChatSendScope, ChatSubmissionOptions as Options } from "./chat-submission-types.ts";
export type { PreparedChatSend, ChatSendScope, ChatSkillsPort } from "./chat-submission-types.ts";

/** A concurrent Send is rejected, never saved as future work. */
export class ChatSubmission {
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }

  async send(input: typeof SendMessage.Type, scope: ChatSendScope): Promise<Response> {
    if (!this.options.fence.tryEnter()) return json({ message: "Chat is busy" }, 409);
    try {
      return await this.submit(input, scope);
    } catch (error) {
      if (error instanceof ChatInvalid) return json({ message: error.message }, 400);
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    } finally {
      this.options.fence.leave();
    }
  }

  private async submit(input: typeof SendMessage.Type, scope: ChatSendScope): Promise<Response> {
    const { harness, runtime, ledger, records, policy } = this.options;
    const hash = await digestText(sendIdentity(input));
    const known = records.identity(input.operationId);
    if (known !== null && known !== hash)
      return json({ message: "Operation identity does not match this message." }, 400);
    const native = await runtime.inputRecord(input.operationId);
    if (native !== undefined) {
      if ("entry" in native) ledger.recordEntry(input.operationId, native.entry, Date.now());
      if (known === null) return json({ message: "Operation identity is unavailable." }, 400);
      await this.options.retain(input, scope);
      ledger.accepted(input.operationId, Date.now());
      return json({ accepted: true, duplicate: true });
    }
    // Accepted-native repair above stays first; a fenced UUID is never revived.
    const fenced = this.options.noAdmissions.find(input.operationId);
    if (fenced !== null) return json(noAdmissionBody(fenced), 409);
    if (!this.options.enabled)
      return json({ message: INFERENCE_UNCONFIGURED, code: "inference_unconfigured" }, 503);
    const resolved = resolveChatSelectionValue(policy, input.selection);
    if (!resolved.ok)
      return json(
        { message: "This model or effort is not enabled in this stage.", code: resolved.code },
        400,
      );
    if (input.text.length === 0 && input.attachments.length === 0 && !input.references?.length)
      return json({ message: "Write a message or attach a file." }, 400);
    const session = harness.session(ROOT_SESSION);
    if (await session.busy()) return json({ message: "Chat is busy" }, 409);
    const conversation = await runtime.conversation();
    const prepared = await this.options.prepare(input, scope, resolved.model);
    if (await session.busy()) {
      await this.options.release(input, scope);
      return json({ message: "Chat is busy" }, 409);
    }
    // The verified library candidate is durable before native admission; a lost
    // finalize stays repairable and a definite busy rejection releases it.
    try {
      await this.options.skills.prepareNew({
        ownerId: scope.ownerId,
        attemptId: input.operationId,
        content: prepared.content,
      });
    } catch (error) {
      await this.options.release(input, scope);
      if (error instanceof SkillRuntimeError)
        return json(
          {
            message: error.message,
            code: error.code === "invalid" ? "submission_failed" : "skills_unavailable",
          },
          error.code === "invalid" ? 400 : 503,
        );
      throw error;
    }
    if (
      !records.bind(
        input.operationId,
        hash,
        {
          selection: input.selection,
          textLength: input.text.length,
          files: prepared.files,
        },
        (await this.options.prepareAccount(input, scope)) ?? undefined,
        undefined,
        scope.officeSession,
      )
    ) {
      this.options.skills.release(input.operationId);
      await this.options.release(input, scope);
      return json({ message: "Operation identity does not match this message." }, 400);
    }
    try {
      await conversation.configure(
        {
          model: { provider: input.selection.provider, modelId: input.selection.model },
          thinkingLevel: input.selection.effort,
        },
        PI_BACKGROUND,
      );
    } catch (error) {
      // No native submission was attempted, so releasing staged bindings is safe.
      this.options.skills.release(input.operationId);
      await this.options.release(input, scope);
      throw error;
    }
    ledger.tentative(input.operationId, Date.now());
    // Native runtime supports reject although the host's PiSubmitOptions omits it.
    const options: PiSubmitOptions = { operationId: input.operationId };
    Object.assign(options, { whenBusy: "reject" });
    try {
      const receipt = await session.submit(prepared.content, options);
      ledger.accepted(input.operationId, Date.now());
      const accepted = await runtime.inputRecord(input.operationId);
      if (accepted !== undefined) {
        // Exact native input evidence: the candidate is now an immutable pin.
        this.options.skills.accept(input.operationId);
        if ("entry" in accepted) ledger.recordEntry(input.operationId, accepted.entry, Date.now());
      }
      await this.options.retain(input, scope);
      return json({ accepted: true, duplicate: !receipt.accepted });
    } catch (error) {
      if (error instanceof ConversationBusy) {
        // Native admission refused before writing; release only this candidate.
        this.options.skills.release(input.operationId);
        await this.options.release(input, scope);
        return json({ message: "Chat is busy" }, 409);
      }
      // Uncertain admission: the candidate and bytes stay for reconciliation.
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
  }
}
