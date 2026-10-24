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

export const workspacePanelId = (id: string) => `workspace-preview-panel-${id}`;
export const workspaceTabId = (id: string) => `workspace-preview-tab-${id}`;
const labelOf = (tab: WorkspacePreviewTab) =>
  tab.kind === "image" || tab.kind === "text" || tab.kind === "office-file"
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
  const anchor = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focused = useRef(0);
  const bounds = useWorkspaceTabBounds(anchor, rightRef);
  useLayoutEffect(() => {
    if (!bounds) return;
    const button = buttons.current.get(preview.activeId);
    button?.parentElement?.scrollIntoView({ block: "nearest", inline: "nearest" });
    if (preview.focus.sequence > focused.current) {
      focused.current = preview.focus.sequence;
      if (preview.focus.target === "tab") button?.focus();
    }
  }, [preview.activeId, preview.focus.sequence, preview.focus.target, bounds]);
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
          const label = labelOf(tab);
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
                id={workspaceTabId(tab.id)}
                aria-controls={workspacePanelId(tab.id)}
                aria-selected={active}
                aria-label={accessible}
                title={accessible}
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

/** Plus and last-close land here without touching drafts, work or stored bytes. */
export function WorkspaceToolsLauncher() {
  const preview = useWorkspacePreview();
  const launcher = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (preview.focus.target === "tools" && preview.focus.sequence > 0) launcher.current?.focus();
  }, [preview.focus.target, preview.focus.sequence]);
  return (
    <section data-cx="workspace-tools" aria-label="Tools">
      <h2>Tools</h2>
      <button ref={launcher} type="button" onClick={preview.showFiles}>
        <Icon name="folder-closed" />
        <span>Files</span>
      </button>
    </section>
  );
}
