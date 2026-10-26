import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type ComponentType,
  type RefObject,
} from "react";
import type { SavedFile } from "@/lib/chat-library-types";
import { Icon } from "./icon";
import ImageIcon from "./image-icon";
import { useWorkspacePreview, type WorkspacePreviewTab } from "./workspace-preview-context";
import { useWorkspaceTabBounds } from "./use-workspace-tab-bounds";
import Tooltip from "./tooltip";
import "./workspace-preview-tabs.css";
import { useReferenceWorkspace } from "./reference-workspace";
import { workspaceReferenceSource } from "./workspace-reference-source";
import { writeReferenceDrag } from "./reference-drag";

export const workspacePanelId = (chatId: string, id: string) =>
  `workspace-preview-panel-${chatId}-${id}`;
export const workspaceTabId = (chatId: string, id: string) =>
  `workspace-preview-tab-${chatId}-${id}`;
/** Accessible name shared by the tab button and its panel, including hidden retained views. */
export const workspaceTabLabel = (tab: WorkspacePreviewTab) =>
  tab.kind === "restoring"
    ? `Saved ${tab.descriptor.kind === "office-file" ? "original" : tab.descriptor.kind} tab`
    : tab.kind === "image" || tab.kind === "text" || tab.kind === "office-file"
      ? tab.file.name
      : tab.kind === "office"
        ? tab.selection.title
        : tab.kind === "files"
          ? "Files"
          : "New tab";
/** The single top-toolbar tab strip; it never loads an original by itself. */
export function WorkspacePreviewTabs({
  rightRef,
  thumbnail: Thumbnail,
  active: visible,
}: {
  rightRef: RefObject<HTMLElement | null>;
  thumbnail?: ComponentType<{ file: SavedFile; active: boolean }>;
  active: boolean;
}) {
  const preview = useWorkspacePreview();
  const tabChatId = preview.chatId ?? "";
  const references = useReferenceWorkspace();
  const sources = preview.chatId === null ? [] : references.sources(preview.chatId);
  const anchor = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  // Chat switches only scroll: a retained view's older focus request never steals the new one.
  const focused = useRef<{ chatId: string; sequence: number }>({ chatId: "", sequence: 0 });
  const bounds = useWorkspaceTabBounds(anchor, rightRef);
  useLayoutEffect(() => {
    if (!bounds) return;
    const button = buttons.current.get(preview.activeId);
    button?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    const chatId = preview.chatId ?? "";
    if (focused.current.chatId !== chatId) {
      focused.current = { chatId, sequence: preview.focus.sequence };
      return;
    }
    if (preview.focus.sequence > focused.current.sequence) {
      focused.current.sequence = preview.focus.sequence;
      if (preview.focus.target === "tab") button?.focus();
    }
  }, [preview.activeId, preview.chatId, preview.focus.sequence, preview.focus.target, bounds]);
  const navigate = (key: string, id: string) => {
    const index = preview.tabs.findIndex((tab) => tab.id === id);
    if (key === "Delete") {
      preview.close(id);
      return true;
    }
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? preview.tabs.length - 1
          : key === "ArrowRight"
            ? (index + 1) % preview.tabs.length
            : key === "ArrowLeft"
              ? (index - 1 + preview.tabs.length) % preview.tabs.length
              : null;
    if (next === null) return false;
    const nextTab = preview.tabs[next];
    if (!nextTab) return false;
    preview.select(nextTab.id);
    return true;
  };
  const style: CSSProperties & { "--cx-tabs-left": string; "--cx-tabs-width": string } = {
    "--cx-tabs-left": `${bounds?.left ?? 0}px`,
    "--cx-tabs-width": `${bounds?.width ?? 0}px`,
  };
  return (
    <div ref={anchor} data-cx="workspace-preview-tabs" style={style} hidden={!bounds}>
      <div
        data-cx="workspace-tab-list"
        role="tablist"
        aria-label="Files and open document previews"
      >
        {preview.tabs.map((tab) => {
          const active = tab.id === preview.activeId;
          const label = workspaceTabLabel(tab);
          const source = workspaceReferenceSource(tab, sources);
          const accessible =
            tab.kind === "image"
              ? `${label}, ${
                  tab.file.origin === "generated" ? "generated" : "uploaded"
                }, saved ${new Date(tab.file.createdAt).toLocaleString()}`
              : label;
          return (
            <div
              key={tab.id}
              data-cx="workspace-tab-shell"
              data-kind={tab.kind}
              data-active={active}
              role="presentation"
            >
              <button
                ref={(node) => {
                  if (node) buttons.current.set(tab.id, node);
                  else buttons.current.delete(tab.id);
                }}
                type="button"
                role="tab"
                id={workspaceTabId(tabChatId, tab.id)}
                aria-controls={workspacePanelId(tabChatId, tab.id)}
                aria-selected={active}
                aria-label={accessible}
                title={accessible}
                draggable={source !== null}
                onDragStart={(event) => {
                  if (!source) {
                    event.preventDefault();
                    return;
                  }
                  writeReferenceDrag(event.dataTransfer, {
                    chatId: source.chatId,
                    key: source.key,
                  });
                }}
                tabIndex={active ? 0 : -1}
                onClick={() => preview.select(tab.id)}
                onKeyDown={(event) => {
                  if (navigate(event.key, tab.id)) event.preventDefault();
                }}
              >
                {tab.kind === "image" ? (
                  Thumbnail ? (
                    <Thumbnail file={tab.file} active={visible} />
                  ) : (
                    <ImageIcon />
                  )
                ) : (
                  <Icon name={tab.kind === "tools" ? "plus" : "folder-closed"} />
                )}
                <span data-cx="workspace-tab-label">{label}</span>
              </button>
              <button
                type="button"
                data-cx="workspace-tab-close"
                aria-label={`Close ${label} tab`}
                tabIndex={active ? 0 : -1}
                onClick={() => preview.close(tab.id)}
              >
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                >
                  <path d="m6 6 12 12M6 18 18 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      <Tooltip label="New tab">
        <button
          type="button"
          data-cx="workspace-tab-add"
          aria-label="New tab"
          onClick={preview.add}
        >
          <Icon name="plus" />
        </button>
      </Tooltip>
    </div>
  );
}

export { WorkspaceToolsLauncher } from "./workspace-tools-launcher";
