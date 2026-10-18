/**
 * Executing-tool resolver: proves the exact accepted native input behind a tool.
 *
 * The proof walks this tool's own lineage (see `chat-account-proof.ts`) and joins
 * it to the immutable host operation evidence for that request id, checking that it
 * matches the durable owner binding, this conversation object's scope and the
 * stored send hash. Nothing here reads the latest transcript, the latest user text
 * or model prose, and there is no fallback: any missing step fails closed and the
 * tool performs no account write. The proven binding is memoized on the live tool
 * task and revalidated against the same immutable host evidence on every reuse.
 */
import { Schema } from "effect";
import type { Storage, ToolExecutionApi, ToolRegistration } from "@earendil-works/pi-durable";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { decodeOption } from "./chat-internal.ts";
import type { AccountOperationView } from "./chat-account-operations.ts";
import { proveNativeInput } from "./chat-account-proof.ts";
import type { FrozenIntent } from "./theme-model.ts";

export type ToolContext = Parameters<ToolRegistration["execute"]>[2];

export type AccountAccess = {
  /** The harness factory storage this conversation is already running on. */
  readonly storage: Storage;
  /** Durable authenticated owner binding, never derived from a model argument. */
  readonly owner: () => string | null;
  /** Conversation object scope, stable across restarts. */
  readonly chatScope: () => string;
  readonly accountOperation: (operationId: string) => AccountOperationView | null;
};

export type ResolvedAccountOperation = {
  readonly operationId: string;
  readonly submissionId: string;
  readonly toolTaskId: string;
  readonly generationTaskId: string;
  readonly assistantEntryId: string;
  readonly ownerId: string;
  readonly chatScope: string;
  readonly conversationId: string;
  readonly identityHash: string;
  readonly intent: FrozenIntent;
};

export type ResolveResult =
  | { readonly ok: true; readonly value: ResolvedAccountOperation }
  | { readonly ok: false; readonly message: string };

const MEMO_KEY = "account.input.v1";

const BindingSchema = Schema.Struct({
  version: Schema.Literal(1),
  operationId: Schema.String,
  submissionId: Schema.String,
  toolTaskId: Schema.String,
  generationTaskId: Schema.String,
  assistantEntryId: Schema.String,
  ownerId: Schema.String,
  chatScope: Schema.String,
  conversationId: Schema.String,
  identityHash: Schema.String,
});

const refuse = (message: string): ResolveResult => ({ ok: false, message });

/** Revalidates a memoized or freshly proven binding against immutable host evidence. */
const acceptBinding = (
  raw: unknown,
  api: ToolExecutionApi,
  access: AccountAccess,
): ResolveResult => {
  const base = decodeOption(BindingSchema, raw);
  if (base === null) return refuse("The account request could not be verified for this tool call.");
  if (base.toolTaskId !== String(api.taskId) || base.conversationId !== String(api.conversationId))
    return refuse("This account request belongs to a different tool call.");
  const ownerId = access.owner();
  if (ownerId === null || ownerId !== base.ownerId || base.chatScope !== access.chatScope())
    return refuse("The signed-in owner of this chat could not be confirmed.");
  const host = access.accountOperation(base.operationId);
  if (host === null || host.identityHash !== base.identityHash)
    return refuse("This request has no frozen account command, so nothing was changed.");
  return {
    ok: true,
    value: {
      operationId: base.operationId,
      submissionId: base.submissionId,
      toolTaskId: base.toolTaskId,
      generationTaskId: base.generationTaskId,
      assistantEntryId: base.assistantEntryId,
      ownerId: base.ownerId,
      chatScope: base.chatScope,
      conversationId: base.conversationId,
      identityHash: base.identityHash,
      // The intent always comes from the immutable host record, never from a memo.
      intent: host.intent,
    },
  };
};

/** Resolves the frozen intent of this tool's accepted operation, memoizing the proof. */
export const resolveAccountOperation = async (
  api: ToolExecutionApi,
  context: ToolContext,
  access: AccountAccess,
): Promise<ResolveResult> => {
  context.abortSignal?.throwIfAborted();
  const memo = await api.memo(MEMO_KEY, context);
  if (memo !== undefined) return acceptBinding(memo, api, access);
  if (api.conversationId !== ROOT_CONVERSATION_ID)
    return refuse("Account changes are supported only in the root conversation.");
  const proof = await proveNativeInput(api, context, access.storage);
  if (proof === null)
    return refuse(
      "The accepted input behind this tool call could not be proven, so nothing was changed.",
    );
  const ownerId = access.owner();
  const host = access.accountOperation(proof.operationId);
  if (host === null)
    return refuse("This request has no frozen account command, so nothing was changed.");
  if (ownerId === null || ownerId !== host.ownerId || host.chatScope !== access.chatScope())
    return refuse("The signed-in owner of this chat could not be confirmed.");
  if (host.conversationId !== String(api.conversationId))
    return refuse("This account request belongs to a different conversation.");
  const candidate = {
    version: 1 as const,
    operationId: proof.operationId,
    submissionId: proof.submissionId,
    toolTaskId: proof.toolTaskId,
    generationTaskId: proof.generationTaskId,
    assistantEntryId: proof.assistantEntryId,
    ownerId,
    chatScope: host.chatScope,
    conversationId: String(api.conversationId),
    identityHash: host.identityHash,
  };
  context.abortSignal?.throwIfAborted();
  const winner = await api.memo(MEMO_KEY, candidate, context);
  return acceptBinding(winner, api, access);
};
