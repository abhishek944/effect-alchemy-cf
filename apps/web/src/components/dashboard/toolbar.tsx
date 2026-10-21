import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
import "./toolbar.css";
import Tooltip from "./tooltip";

type Props = {
  title: string;
  chatTitle?: ReactNode;
  previewTabs?: ReactNode;
  sidebarOpen: boolean;
  rightOpen: boolean;
  fullView: boolean;
  toggleSidebar: () => void;
  toggleRight: () => void;
  toggleFullView: () => void;
};
function Control({
  label,
  icon,
  onClick,
  expanded,
  controls,
  pressed,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
  pressed?: boolean;
}) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        data-cx="icon-button"
        aria-label={label}
        aria-controls={controls}
        aria-expanded={expanded}
        aria-pressed={pressed}
        onClick={onClick}
      >
        <Icon name={icon} />
      </button>
    </Tooltip>
  );
}
export default function Toolbar({
  title,
  chatTitle,
  previewTabs,
  sidebarOpen,
  rightOpen,
  fullView,
  toggleSidebar,
  toggleRight,
  toggleFullView,
}: Props) {
  return (
    <header data-cx="toolbar" data-chat-title={Boolean(chatTitle) && !fullView}>
      <div data-cx="toolbar-navigation">
        <Control label="Back" icon="arrow-left" onClick={() => window.history.back()} />
        <Control label="Forward" icon="arrow-right" onClick={() => window.history.forward()} />
        <Control
          label={sidebarOpen ? "Close left sidebar" : "Open left sidebar"}
          icon="panel-left"
          expanded={sidebarOpen}
          controls="workspace-sidebar"
          onClick={toggleSidebar}
        />
      </div>
      {chatTitle && !fullView && <div data-cx="toolbar-chat-title">{chatTitle}</div>}
      {title && (
        <div data-cx="toolbar-title">
          <span>{title}</span>
        </div>
      )}
      {previewTabs}
      <div data-cx="toolbar-actions">
        <Control
          label={fullView ? "Exit full view" : "Enter full view"}
          icon={fullView ? "minimize" : "maximize"}
          pressed={fullView}
          controls="workspace-right"
          onClick={toggleFullView}
        />
        <Control
          label={rightOpen ? "Close right section" : "Open right section"}
          icon="panel-right"
          expanded={rightOpen}
          controls="workspace-right"
          onClick={toggleRight}
        />
      </div>
    </header>
  );
}
