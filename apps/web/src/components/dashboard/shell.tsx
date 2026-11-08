import RouteLink from "@/lib/route-link";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import PaneResizer from "./pane-resizer";
import SettingsNavigation from "./settings-navigation";
import "./pane-resizer.css";
import { usePanes } from "./use-panes";
import { useFocusModality } from "./use-focus-modality";
import { Icon } from "./icon";
import type { SettingsSection } from "./model";
import { ChatLibraryWorkspace } from "./chat-library-workspace";
import { ChatLibraryThumbnail } from "./chat-library-thumbnail";
import { useWorkspacePreview } from "./workspace-preview-context";
import { WorkspacePreviewTabs } from "./workspace-preview-tabs";

import { useDashboardTheme } from "./theme";
import Toolbar from "./toolbar";
import Tooltip from "./tooltip";
import "./tokens.css";
import "./shell.css";
import "./responsive.css";
import "./controls.css";

type Props = {
  accountId: string;
  section: SettingsSection | null;
  subscription?: boolean;
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
  account,
  children,
  sidebar,
  chatTitle,
  notFound = false,
  homeHref = "/dashboard",
}: Props) {
  const chatWorkspace = section === null && !subscription && !notFound;
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
  const showSidebar = !subscription && sidebarOpen;
  const effectiveFullView = !subscription && fullView;
  const pageTitle = subscription ? "Subscription" : settings ? "Settings" : "Dashboard";
  const title = notFound ? "Page not found" : pageTitle;

  return (
    <div
      ref={focusRef}
      data-dashboard
      data-theme={theme}
      style={paneStyle}
      data-sidebar-open={showSidebar}
      data-right-open={!subscription && rightOpen}
      data-full-view={effectiveFullView}
    >
      <a
        href={effectiveFullView ? "#workspace-right" : "#dashboard-content"}
        data-cx="skip-link"
        data-skip="main"
      >
        Skip to content
      </a>
      {!subscription && rightOpen && !effectiveFullView && (
        <a href="#workspace-right" data-cx="skip-link" data-skip="right">
          Skip to right section
        </a>
      )}
      <Toolbar
        title={settings || subscription || notFound ? title : ""}
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
        showPanes={!subscription}
        toggleSidebar={toggleSidebar}
        toggleRight={toggleRight}
        toggleFullView={toggleFullView}
      />
      <nav data-cx="rail" aria-label="Global navigation">
        <Tooltip label="Home" side="right">
          <RouteLink
            href={homeHref}
            data-cx="rail-link"
            aria-label="Dashboard"
            aria-current={!settings && !subscription && !notFound ? "page" : undefined}
          >
            <Icon name="house" />
          </RouteLink>
        </Tooltip>
        <Tooltip label="Subscription" side="right">
          <RouteLink
            href="/subscription"
            data-cx="rail-link"
            aria-label="Subscription"
            aria-current={subscription ? "page" : undefined}
          >
            <Icon name="credit-card" />
          </RouteLink>
        </Tooltip>
        <Tooltip label="Settings" side="right">
          <RouteLink
            href="/settings/general"
            data-cx="rail-link"
            aria-label="Settings"
            aria-current={settings ? "page" : undefined}
          >
            <Icon name="settings" />
          </RouteLink>
        </Tooltip>
        <div data-cx="rail-account">{account}</div>
      </nav>
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
        {!subscription && rightOpen && !effectiveFullView && (
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
          {!settings && !subscription && !notFound && <h1 className="sr-only">Dashboard</h1>}
          {children}
        </main>
        <section
          ref={rightRef}
          id="workspace-right"
          data-cx="right-section"
          aria-label="Right section"
          tabIndex={-1}
          hidden={subscription || !rightOpen}
        >
          <ChatLibraryWorkspace active={chatWorkspace && rightOpen} />
        </section>
      </div>
    </div>
  );
}
