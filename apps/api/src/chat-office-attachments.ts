import { LiveDoc } from "@earendil-works/pi-durable";
import { OfficeUnavailable, safeFailure } from "@starter/office-contract";
import {
  AttachmentListRequest,
  OFFICE_ATTACHMENTS_TOOL_NAME,
  type OfficeAttachmentPage,
  type OfficeAttachmentsRequest,
} from "@starter/office-pi";
import { requireAcceptedInputAccess, resolveAcceptedInput } from "./chat-accepted-input.ts";
import type { AcceptedInputAccess } from "./chat-accepted-input.ts";
import type { ConversationFileEnv } from "./chat-conversation-files.ts";
import { decodeOption } from "./chat-internal.ts";
import { createChatLibraryClient } from "./chat-library-client.ts";
import { proveNativeLineage } from "./chat-native-provenance.ts";
import { officeDenied } from "./office-private-authority.ts";

const PAGE_LIMIT = 20;

/**
 * The `get_attachments` capability: prove this exact tool call, then read the saved library of its
 * own bound owner/chat. No model-selected owner or chat, no bytes, no excerpt and no write grant.
 */
export async function readOfficeAttachments(
  env: ConversationFileEnv,
  access: AcceptedInputAccess,
  input: OfficeAttachmentsRequest,
): Promise<OfficeAttachmentPage> {
  const { api, context, cursor } = input;
  requireAcceptedInputAccess(access, context);
  if (api.conversationId !== access.conversationId) throw officeDenied();
  const proof = await proveNativeLineage(api, context, {
    storage: access.storage,
    runningTool: true,
    callNames: [OFFICE_ATTACHMENTS_TOOL_NAME],
    liveSlotName: true,
    inspectArguments: ({ arguments: raw }) => {
      const value: unknown = raw ?? {};
      if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
      if (Object.keys(value).some((key) => key !== "cursor")) return null;
      const decoded = decodeOption(AttachmentListRequest, value);
      return decoded !== null && decoded.cursor === cursor ? decoded : null;
    },
  });
  if (proof === null) throw officeDenied();
  const live = await api.snapshot(LiveDoc, api.conversationId, context);
  const submission = live?.run?.inputs.length === 1 ? live.run.inputs[0] : undefined;
  if (submission === undefined || String(submission) !== proof.submissionId) throw officeDenied();
  const current = await resolveAcceptedInput(access, api.conversationId, submission, context);
  if (current.candidate.operationId !== proof.operationId) throw officeDenied();
  requireAcceptedInputAccess(access, context);
  if (env.ChatCatalog === undefined) throw new OfficeUnavailable(safeFailure("UNAVAILABLE"));
  const page = await createChatLibraryClient(
    env.ChatCatalog.getByName(`owner:${access.ownerId}`),
  ).list(access.chatId, {
    limit: PAGE_LIMIT,
    ...(cursor === undefined ? {} : { cursor }),
  });
  requireAcceptedInputAccess(access, context);
  if (page.chatId !== access.chatId) throw officeDenied();
  const files = page.files
    .filter((file) => file.chatId === access.chatId && file.state === "ready")
    .map((file) => ({
      id: file.id,
      name: file.name,
      kind: file.kind,
      mediaType: file.mediaType,
      byteSize: file.byteSize,
    }));
  return Object.freeze({ files: Object.freeze(files), nextCursor: page.nextCursor });
}
