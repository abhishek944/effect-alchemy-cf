import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import PaneResizer from "./pane-resizer";
import SettingsNavigation from "./settings-navigation";
import "./pane-resizer.css";
import { usePanes } from "./use-panes";
import { useFocusModality } from "./use-focus-modality";
import type { SettingsSection } from "./model";
import { ChatLibraryWorkspace } from "./chat-library-workspace";
import { ChatLibraryThumbnail } from "./chat-library-thumbnail";
import { useWorkspacePreview } from "./workspace-preview-context";
import { WorkspacePreviewTabs } from "./workspace-preview-tabs";

import { useDashboardTheme } from "./theme";
import Toolbar from "./toolbar";
import RailNavigation from "./rail-navigation";
import "./tokens.css";
import "./shell.css";
import "./responsive.css";
import "./controls.css";

type Props = {
  accountId: string;
  section: SettingsSection | null;
  subscription?: boolean;
  usage?: boolean;
  account: ReactNode;
  children?: ReactNode;
  sidebar?: ReactNode;
  chatTitle?: ReactNode;
  notFound?: boolean;
  homeHref?: string;
};

export default function DashboardShell({
  accountId,
  section,
  subscription = false,
  usage = false,
  account,
  children,
  sidebar,
  chatTitle,
  notFound = false,
  homeHref = "/dashboard",
}: Props) {
  const standalone = subscription || usage;
  const chatWorkspace = section === null && !standalone && !notFound;
  const {
    sidebarOpen,
    rightOpen,
    fullView,
    rightRef,
    openRight,
    toggleSidebar,
    toggleRight,
    toggleFullView,
  } = usePanes(chatWorkspace, accountId);
  const { registerReveal } = useWorkspacePreview();
  useEffect(() => registerReveal(openRight), [registerReveal, openRight]);
  const { theme } = useDashboardTheme();
  const focusRef = useFocusModality();
  const [search, setSearch] = useState("");
  const [sidebarWidth, setSidebarWidth] = useState(238);
  const [chatWidth, setChatWidth] = useState(44);
  const paneStyle: CSSProperties & {
    "--cx-sidebar-width": string;
    "--cx-chat-width": string;
  } = {
    "--cx-sidebar-width": `${sidebarWidth}px`,
    "--cx-chat-width": `${chatWidth}%`,
  };
  const settings = section !== null;
  const showSidebar = !standalone && sidebarOpen;
  const effectiveFullView = !standalone && fullView;
  const pageTitle = usage
    ? "Usage"
    : subscription
      ? "Subscription"
      : settings
        ? "Settings"
        : "Dashboard";
  const title = notFound ? "Page not found" : pageTitle;

  return (
    <div
      ref={focusRef}
      data-dashboard
      data-theme={theme}
      style={paneStyle}
      data-sidebar-open={showSidebar}
      data-right-open={!standalone && rightOpen}
      data-full-view={effectiveFullView}
    >
      <a
        href={effectiveFullView ? "#workspace-right" : "#dashboard-content"}
        data-cx="skip-link"
        data-skip="main"
      >
        Skip to content
      </a>
      {!standalone && rightOpen && !effectiveFullView && (
        <a href="#workspace-right" data-cx="skip-link" data-skip="right">
          Skip to right section
        </a>
      )}
      <Toolbar
        title={settings || standalone || notFound ? title : ""}
        chatTitle={chatTitle}
        previewTabs={
          chatWorkspace ? (
            <WorkspacePreviewTabs
              rightRef={rightRef}
              thumbnail={ChatLibraryThumbnail}
              active={rightOpen}
            />
          ) : undefined
        }
        sidebarOpen={showSidebar && !effectiveFullView}
        rightOpen={rightOpen}
        fullView={effectiveFullView}
        showPanes={!standalone}
        toggleSidebar={toggleSidebar}
        toggleRight={toggleRight}
        toggleFullView={toggleFullView}
      />
      <RailNavigation
        homeHref={homeHref}
        current={
          notFound
            ? null
            : usage
              ? "usage"
              : settings
                ? "settings"
                : subscription
                  ? "subscription"
                  : "home"
        }
        account={account}
      />
      <aside id="workspace-sidebar" data-cx="sidebar" hidden={!showSidebar}>
        {settings ? (
          <SettingsNavigation section={section} search={search} onSearch={setSearch} />
        ) : (
          (sidebar ?? null)
        )}
        {showSidebar && !effectiveFullView && (
          <PaneResizer
            target="workspace-sidebar"
            label="Resize sidebar"
            value={sidebarWidth}
            min={180}
            max={420}
            onChange={setSidebarWidth}
          />
        )}
      </aside>
      <div data-cx="work-area">
        {!standalone && rightOpen && !effectiveFullView && (
          <PaneResizer
            target="dashboard-content"
            label="Resize conversation panel"
            value={chatWidth}
            min={30}
            max={70}
            percentage
            onChange={setChatWidth}
          />
        )}
        <main id="dashboard-content" data-cx="canvas" tabIndex={-1} aria-label={title}>
          {!settings && !standalone && !notFound && <h1 className="sr-only">Dashboard</h1>}
          {children}
        </main>
        <section
          ref={rightRef}
          id="workspace-right"
          data-cx="right-section"
          aria-label="Right section"
          tabIndex={-1}
          hidden={standalone || !rightOpen}
        >
          <ChatLibraryWorkspace active={chatWorkspace && rightOpen} />
        </section>
      </div>
    </div>
  );
}
