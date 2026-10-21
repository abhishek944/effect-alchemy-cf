import { useChatStore } from "@/lib/chat-store-context";
import { ChatLibraryPanel } from "./chat-library-panel";
import { ChatLibraryPreview } from "./chat-library-preview";
import { ChatLibraryOpenStatus } from "./chat-library-workspace-status";
import { useChatLibrary } from "./use-chat-library";
import { useChatLibraryFile } from "./use-chat-library-file";
import { useChatLibraryOpen } from "./use-chat-library-open";
import { useWorkspacePreview, type WorkspacePreviewTab } from "./workspace-preview-context";
import { WorkspaceToolsLauncher, workspacePanelId, workspaceTabId } from "./workspace-preview-tabs";
import "./chat-library-workspace.css";
import { OfficeFiles } from "./office-files";
import { OfficeSurface } from "./office-surface";
import { useWorkspaceOffice } from "./workspace-office-context";

type ViewProps = { chatId: string | null; active: boolean; archived: boolean };

function FilesView({ chatId, active, archived, title }: ViewProps & { title: string }) {
  const { snapshot } = useChatStore();
  const running = snapshot?.chat.id === chatId && snapshot.isRunning;
  const library = useChatLibrary(chatId, { active, refreshKey: running ? "running" : "settled" });
  const read = useChatLibraryOpen({ active });
  if (!chatId)
    return (
      <output data-cx="chat-library-workspace-empty">
        Select a chat to browse its saved files.
      </output>
    );
  return (
    <>
      <OfficeFiles active={active} refreshKey={running ? "running" : "settled"} />
      <ChatLibraryPanel
        library={library}
        chatTitle={title}
        archived={archived}
        active={active}
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
  tab: Extract<WorkspacePreviewTab, { kind: "image" }>;
}) {
  const metadata = useChatLibraryFile(chatId, tab.file.id, active);
  const read = useChatLibraryOpen({ active });
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

/** Parent supplies right-section visibility; tab state and draft ownership stay outside. */
export function ChatLibraryWorkspace({ active }: { active: boolean }) {
  const store = useChatStore();
  const preview = useWorkspacePreview();
  const office = useWorkspaceOffice();
  const chatId = preview.chatId === store.selectedId ? store.selectedId : null;
  const chat =
    store.snapshot?.chat.id === chatId
      ? store.snapshot.chat
      : store.chats.find((value) => value.id === chatId);
  return (
    <div data-cx="chat-library-workspace" hidden={!active}>
      {office.notice && (
        <p data-cx="office-notice" role="alert">
          {office.notice}
        </p>
      )}
      {office.busy && <output data-cx="office-notice">Finishing acknowledged Office saves…</output>}
      {preview.tabs.map((tab) => {
        const visible = active && tab.id === preview.activeId;
        return (
          <section
            key={`${chatId}/${tab.id}`}
            data-cx="chat-library-workspace-panel"
            id={workspacePanelId(tab.id)}
            role="tabpanel"
            aria-labelledby={workspaceTabId(tab.id)}
            hidden={!visible}
          >
            {tab.kind === "office" && chatId !== null ? (
              <OfficeSurface chatId={chatId} id={tab.id} selection={tab.selection} />
            ) : tab.kind === "files" ? (
              <FilesView
                chatId={chatId}
                active={visible}
                archived={chat?.archived ?? false}
                title={chat?.title ?? "This chat"}
              />
            ) : tab.kind === "image" ? (
              <ImageView
                chatId={chatId}
                active={visible}
                archived={chat?.archived ?? false}
                tab={tab}
              />
            ) : visible ? (
              <WorkspaceToolsLauncher />
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
