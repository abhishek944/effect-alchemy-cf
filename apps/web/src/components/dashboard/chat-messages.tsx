import { useMemo } from "react";
import { MessagePartPrimitive, MessagePrimitive, useAuiState } from "@assistant-ui/react";
import { chatAttachmentUrl } from "@/lib/chat-capability-api";
import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import { formatFileSize } from "@/lib/chat-file-local";
import { ChatMarkdown } from "./chat-markdown";
import { MessageText, useHistoryText } from "./chat-history-ui";
import { AssistantActions, UserActions } from "./chat-message-actions";
import ChatFilePreview, { type PreviewFile } from "./chat-file-preview";
import { usePreviewReservation } from "./use-preview-reservation";
import "./chat-feedback.css";
import "./chat-message-actions.css";

function useOptimistic(): boolean {
  return useAuiState((state) => {
    const metadata = state.message.metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
    return (metadata as Record<string, unknown>).isOptimistic === true;
  });
}

function previewOf(file: ChatFileDescriptor): PreviewFile {
  const url = chatAttachmentUrl(file.chatId, file.id);
  return {
    id: file.id,
    name: file.name,
    kind: file.kind,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    width: file.width,
    height: file.height,
    url: file.kind === "image" ? url : null,
    loadText:
      file.kind === "text"
        ? async () => {
            const response = await fetch(url, { credentials: "same-origin" });
            if (!response.ok) throw new Error(`Preview failed (${response.status}).`);
            return response.text();
          }
        : null,
    reserved: false,
    reservationKey: null,
    readOnly: true,
  };
}

/** Read-only originals attached to a sent user message; preview loads on demand. */
function SentFiles() {
  const messageId = useAuiState((state) => state.message.id);
  const { attachmentsFor } = useHistoryText();
  const files = attachmentsFor(messageId);
  const previews = useMemo(() => files.map(previewOf), [files]);
  const preview = usePreviewReservation(previews);
  if (files.length === 0) return null;
  return (
    <div data-cx="sent-files">
      {files.map((file, index) => (
        <div key={file.id} data-cx="sent-file-row">
          <span data-cx="sent-file-body">
            <span data-cx="sent-file-name">{file.name}</span>
            <small data-cx="sent-file-meta">
              {formatFileSize(file.byteSize)}
              {file.width && file.height ? ` · ${file.width}×${file.height}` : ""}
            </small>
          </span>
          <button
            type="button"
            data-cx="file-action"
            aria-label={`Preview ${file.name}`}
            onClick={() => preview.select(index)}
          >
            Preview
          </button>
        </div>
      ))}
      {preview.index !== null && (
        <ChatFilePreview
          files={previews}
          index={preview.index}
          allowed={preview.allowed}
          withheldReason={preview.withheldReason}
          lease={preview.lease}
          onIndexChange={(index) => preview.select(index)}
          onClose={preview.close}
        />
      )}
    </div>
  );
}

function UserText() {
  return <MessagePartPrimitive.Text component="p" smooth={false} />;
}

const assistantParts = { Text: ChatMarkdown };
const userParts = { Text: UserText };

/** Message-scoped child so the current assistant-ui message id is available. */
function MessageTail() {
  const messageId = useAuiState((state) => state.message.id);
  return <MessageText messageId={messageId} />;
}

function WorkingDots() {
  const emptyRunning = useAuiState(
    (state) =>
      state.message.status?.type === "running" &&
      !state.message.content.some((part) => part.type === "text" && part.text.length > 0),
  );
  const { working } = useHistoryText();
  if (!working || !emptyRunning) return null;
  return (
    <div data-cx="chat-working">
      <span data-cx="chat-working-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span>Working</span>
    </div>
  );
}

export function UserMessage() {
  const optimistic = useOptimistic();
  return (
    <MessagePrimitive.Root data-cx="chat-message" data-role="user">
      <MessagePrimitive.Parts components={userParts} />
      {!optimistic && <SentFiles />}
      <MessageTail />
      <UserActions optimistic={optimistic} />
    </MessagePrimitive.Root>
  );
}

export function ChatMessage({ messageRole = "assistant" }: { messageRole?: "user" | "assistant" }) {
  const optimistic = useOptimistic();
  return (
    <MessagePrimitive.Root data-cx="chat-message" data-role={messageRole}>
      <MessagePrimitive.Parts
        components={messageRole === "assistant" ? assistantParts : userParts}
      />
      <MessageTail />
      {messageRole === "assistant" && (
        <>
          <WorkingDots />
          <AssistantActions optimistic={optimistic} />
        </>
      )}
    </MessagePrimitive.Root>
  );
}
