import { ConversationBusy, type UserInput } from "@earendil-works/pi-durable";
import { ROOT_SESSION, type PiHarness, type PiSubmitOptions } from "agents/harness/pi";
import type { AccountOperationRecord } from "./chat-account-operations.ts";
import type { FileDescriptor } from "./chat-attachment-schema.ts";
import type { Chat } from "./chat-model.ts";
import type { ChatCatalogModel } from "./chat-capabilities.ts";
import { resolveChatSelectionValue, type StageModelPolicy } from "./chat-capability-policy.ts";
import { digestText, json } from "./chat-internal.ts";
import type { ChatLedger } from "./chat-ledger.ts";
import {
  ChatInvalid,
  INFERENCE_UNCONFIGURED,
  SUBMISSION_FAILED,
  type SendMessage,
} from "./chat-model.ts";
import { PI_BACKGROUND, type ChatRuntime } from "./chat-runtime.ts";
import { sendIdentity } from "./chat-send-identity.ts";
import type { ChatSendRecords } from "./chat-send-records.ts";
import { validateChatImageContext } from "./chat-conversation-files.ts";

export type PreparedChatSend = { content: UserInput; files: readonly FileDescriptor[] };
export type ChatSendScope = { chat: Chat; ownerId: string };
type Options = {
  harness: PiHarness;
  runtime: ChatRuntime;
  ledger: ChatLedger;
  records: ChatSendRecords;
  policy: StageModelPolicy;
  enabled: boolean;
  prepare: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
    model: ChatCatalogModel,
  ) => Promise<PreparedChatSend>;
  /**
   * Prepares the immutable account evidence for this exact send. Runs before
   * native admission and is stored in the same insert as the send record, so a
   * rejected, busy or duplicated delivery can never amend another operation's
   * authority.
   */
  prepareAccount: (
    input: typeof SendMessage.Type,
    scope: ChatSendScope,
  ) => Promise<AccountOperationRecord | null>;
  retain: (input: typeof SendMessage.Type, scope: ChatSendScope) => Promise<void>;
  release: (input: typeof SendMessage.Type, scope: ChatSendScope) => Promise<void>;
};

/** A concurrent Send is rejected, never saved as future work. */
export class ChatSubmission {
  private submitting = false;
  private readonly options: Options;
  constructor(options: Options) {
    this.options = options;
  }

  async send(input: typeof SendMessage.Type, scope: ChatSendScope): Promise<Response> {
    if (this.submitting) return json({ message: "Chat is busy" }, 409);
    this.submitting = true;
    try {
      return await this.submit(input, scope);
    } catch (error) {
      if (error instanceof ChatInvalid) return json({ message: error.message }, 400);
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    } finally {
      this.submitting = false;
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
    if (!this.options.enabled)
      return json({ message: INFERENCE_UNCONFIGURED, code: "inference_unconfigured" }, 503);
    const resolved = resolveChatSelectionValue(policy, input.selection);
    if (!resolved.ok)
      return json(
        { message: "This model or effort is not enabled in this stage.", code: resolved.code },
        400,
      );
    if (input.text.length === 0 && input.attachments.length === 0)
      return json({ message: "Write a message or attach a file." }, 400);
    const session = harness.session(ROOT_SESSION);
    if (await session.busy()) return json({ message: "Chat is busy" }, 409);
    const conversation = await runtime.conversation();
    await validateChatImageContext(runtime, resolved.model);
    const prepared = await this.options.prepare(input, scope, resolved.model);
    if (await session.busy()) {
      await this.options.release(input, scope);
      return json({ message: "Chat is busy" }, 409);
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
      )
    ) {
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
      if (accepted !== undefined && "entry" in accepted)
        ledger.recordEntry(input.operationId, accepted.entry, Date.now());
      await this.options.retain(input, scope);
      return json({ accepted: true, duplicate: !receipt.accepted });
    } catch (error) {
      if (error instanceof ConversationBusy) {
        await this.options.release(input, scope);
        return json({ message: "Chat is busy" }, 409);
      }
      return json({ message: SUBMISSION_FAILED, code: "submission_failed" }, 503);
    }
  }
}
