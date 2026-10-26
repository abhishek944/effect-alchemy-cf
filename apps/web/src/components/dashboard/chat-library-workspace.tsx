import { useState } from "react";
import { useChatStore } from "@/lib/chat-store-context";
import { ChatLibraryPanel } from "./chat-library-panel";
import { ChatLibraryPreview } from "./chat-library-preview";
import { ChatLibraryOpenStatus } from "./chat-library-workspace-status";
import { useChatLibrary } from "./use-chat-library";
import { useChatLibraryFile } from "./use-chat-library-file";
import { useChatLibraryOpen } from "./use-chat-library-open";
import { useWorkspacePreview, type WorkspacePreviewTab } from "./workspace-preview-context";
import {
  WorkspaceToolsLauncher,
  workspacePanelId,
  workspaceTabId,
  workspaceTabLabel,
} from "./workspace-preview-tabs";
import "./chat-library-workspace.css";
import { OfficeFiles } from "./office-files";
import { OfficeSurface } from "./office-surface";
import { OfficeOriginal } from "./office-original";
import { WorkspacePreviewRestore } from "./workspace-preview-restore";
import { useOriginalReferenceSource } from "./reference-original-source";

type ViewProps = { chatId: string | null; active: boolean; archived: boolean };

function FilesView({ chatId, active, archived, title }: ViewProps & { title: string }) {
  const { runningChatIds } = useChatStore();
  const running = chatId !== null && runningChatIds.has(chatId);
  const [refresh, setRefresh] = useState(0);
  const refreshKey = `${running ? "running" : "settled"}:${refresh}`;
  const library = useChatLibrary(chatId, { active, refreshKey });
  const read = useChatLibraryOpen({ active, chatId });
  if (!chatId) return null;
  return (
    <>
      <OfficeFiles active={active} refreshKey={refreshKey} />
      <ChatLibraryPanel
        library={library}
        chatTitle={title}
        archived={archived}
        active={active}
        onRefresh={() => setRefresh((value) => value + 1)}
        onOpenImage={(id) => void read.open(id)}
      />
      <ChatLibraryOpenStatus read={read} />
    </>
  );
}

function ImageView({
  chatId,
  active,
  archived,
  tab,
}: ViewProps & {
  tab: Extract<WorkspacePreviewTab, { kind: "image" | "text" }>;
}) {
  const metadata = useChatLibraryFile(chatId, tab.file.id);
  const read = useChatLibraryOpen({ active, chatId });
  const preview = useWorkspacePreview();
  useOriginalReferenceSource(tab.kind === "image" ? metadata.file : null, async () => {
    if (!metadata.file) throw new Error("The saved original is unavailable.");
    preview.openImage(metadata.file);
  });
  if (!chatId)
    return (
      <output data-cx="chat-library-workspace-empty">
        Select this file's chat to read its saved original.
      </output>
    );
  return (
    <>
      {metadata.file ? (
        <ChatLibraryPreview
          file={metadata.file}
          active={active}
          archived={archived}
          onOpenSource={(id) => void read.open(id)}
          textReferenceReveal={
            tab.kind === "text"
              ? () => {
                  if (metadata.file) preview.openImage(metadata.file);
                }
              : undefined
          }
        />
      ) : metadata.state === "error" ? (
        <div data-cx="chat-library-workspace-empty" role="alert">
          <strong>Could not read {tab.file.name}</strong>
          <p>{metadata.error}</p>
          <button type="button" disabled={!active} onClick={metadata.retry}>
            Retry loading file
          </button>
          <small>The saved identity is kept. This only reads file metadata.</small>
        </div>
      ) : (
        <output data-cx="chat-library-workspace-empty">Loading saved file…</output>
      )}
      <ChatLibraryOpenStatus read={read} />
    </>
  );
}

/**
 * Parent supplies right-section visibility. Every retained chat view stays mounted; only the
 * selected chat's active tab is shown, so hidden editors, imports and reads keep their owners.
 */
export function ChatLibraryWorkspace({ active }: { active: boolean }) {
  const store = useChatStore();
  const preview = useWorkspacePreview();
  const chatOf = (chatId: string) =>
    store.snapshot?.chat.id === chatId
      ? store.snapshot.chat
      : store.chats.find((value) => value.id === chatId);
  return (
    <div data-cx="chat-library-workspace" hidden={!active}>
      {preview.workspaces.flatMap(({ chatId, view }) => {
        const selected = chatId === store.selectedId;
        const chat = chatOf(chatId);
        return view.tabs.map((tab) => {
          const visible = active && selected && tab.id === view.activeId;
          return (
            <section
              key={`${chatId}/${tab.id}`}
              data-cx="chat-library-workspace-panel"
              id={workspacePanelId(chatId, tab.id)}
              role="tabpanel"
              aria-label={workspaceTabLabel(tab)}
              {...(selected ? { "aria-labelledby": workspaceTabId(chatId, tab.id) } : {})}
              hidden={!visible}
            >
              {tab.kind === "restoring" ? (
                <WorkspacePreviewRestore chatId={chatId} tab={tab} />
              ) : tab.kind === "office" ? (
                <OfficeSurface chatId={chatId} id={tab.id} selection={tab.selection} />
              ) : tab.kind === "office-file" ? (
                <OfficeOriginal file={tab.file} id={tab.id} archived={chat?.archived ?? false} />
              ) : tab.kind === "files" ? (
                <FilesView
                  chatId={chatId}
                  active={visible}
                  archived={chat?.archived ?? false}
                  title={chat?.title ?? "This chat"}
                />
              ) : tab.kind === "image" || tab.kind === "text" ? (
                <ImageView
                  chatId={chatId}
                  active={visible}
                  archived={chat?.archived ?? false}
                  tab={tab}
                />
              ) : (
                <WorkspaceToolsLauncher />
              )}
            </section>
          );
        });
      })}
    </div>
  );
}
