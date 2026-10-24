import { useAuiState } from "@assistant-ui/react";
import type { ChatFileDescriptor } from "@/lib/chat-capability-file-types";
import { useChatStore } from "@/lib/chat-store-context";
import { ChatLibraryResults } from "./chat-library-results";
import { ChatLibraryOpenStatus } from "./chat-library-workspace-status";
import { useChatLibraryOpen } from "./use-chat-library-open";
import { useChatLibraryFile } from "./use-chat-library-file";
import { useChatGeneratedFiles } from "./use-chat-generated-files";
import { useChatReferenceFocus } from "./chat-reference-focus";
import { useHistoryText } from "./chat-history-ui";
import "./chat-message-files.css";

function useFileActions(active: boolean) {
  const store = useChatStore();
  const focus = useChatReferenceFocus();
  const read = useChatLibraryOpen({ active });
  return {
    read,
    actions: {
      onOpenImage: (file: { id: string }) => {
        void read.open(file.id);
      },
      onOpenSource: (id: string) => {
        void read.open(id);
      },
      onPrepareReference: (file: Parameters<typeof store.references.add>[0]) => {
        if (store.references.add(file)) focus.focus();
      },
      onUnavailable: store.references.markUnavailable,
    },
  };
}

function UploadedFile({ file, active }: { file: ChatFileDescriptor; active: boolean }) {
  const store = useChatStore();
  const metadata = useChatLibraryFile(store.selectedId, file.id, active);
  const { read, actions } = useFileActions(active);
  return (
    <>
      {metadata.file ? (
        <ChatLibraryResults
          files={[metadata.file]}
          archived={Boolean(store.snapshot?.chat.archived)}
          active={active}
          {...actions}
        />
      ) : (
        <div data-cx="chat-message-file-read" aria-live="polite">
          <strong>{file.name}</strong>
          <span>{metadata.error ?? "Loading saved file…"}</span>
          {metadata.state === "error" && (
            <button type="button" onClick={metadata.retry}>
              Retry loading file
            </button>
          )}
        </div>
      )}
      <ChatLibraryOpenStatus read={read} />
    </>
  );
}

export function SentSavedFiles() {
  const messageId = useAuiState((state) => state.message.id);
  const { attachmentsFor, active } = useHistoryText();
  const files = attachmentsFor(messageId);
  if (!files.length) return null;
  return (
    <div data-cx="chat-message-sent-files">
      {files.map((file) => (
        <UploadedFile key={file.id} file={file} active={active} />
      ))}
    </div>
  );
}

/** This is a receipt read, not a pending generation/job indicator or paid retry. */
export function AssistantSavedFiles() {
  const messageId = useAuiState((state) => state.message.id);
  const store = useChatStore();
  const { generatedFor, factsFor, active } = useHistoryText();
  const enabled = generatedFor(messageId);
  const page = useChatGeneratedFiles({
    chatId: store.selectedId,
    messageId,
    attachment: store.attachment,
    enabled,
    active,
    pending: factsFor(messageId).pending,
  });
  const { read, actions } = useFileActions(active);
  if (!enabled) return null;
  return (
    <div data-cx="chat-message-generated-files">
      <ChatLibraryResults
        files={page.files}
        archived={Boolean(store.snapshot?.chat.archived)}
        active={active}
        {...actions}
      />
      {page.state === "loading" && (
        <output data-cx="chat-message-file-read">Loading saved images…</output>
      )}
      {(page.state === "error" || (page.state === "ready" && !page.files.length)) && (
        <div data-cx="chat-message-file-read" role="alert">
          <span>{page.error ?? "No stored files were returned for this response."}</span>
          <button type="button" onClick={page.retry}>
            Retry loading saved files
          </button>
        </div>
      )}
      {(page.hasPrevious || page.hasNext) && (
        <nav data-cx="chat-message-file-pages" aria-label="Saved response file pages">
          <button
            type="button"
            disabled={!page.hasPrevious || page.state === "loading"}
            onClick={page.previous}
          >
            Previous files
          </button>
          <button
            type="button"
            disabled={!page.hasNext || page.state !== "ready"}
            onClick={page.next}
          >
            More saved files
          </button>
        </nav>
      )}
      <ChatLibraryOpenStatus read={read} />
    </div>
  );
}
