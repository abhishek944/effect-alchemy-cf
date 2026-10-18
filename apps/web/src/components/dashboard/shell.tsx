import RouteLink from "@/lib/route-link";
import { useState, type CSSProperties, type ReactNode } from "react";
import PaneResizer from "./pane-resizer";
import SearchField from "./search-field";
import "./pane-resizer.css";
import { usePanes } from "./use-panes";
import { useFocusModality } from "./use-focus-modality";
import { Icon, type IconName } from "./icon";
import type { SettingsSection } from "./model";
import { useDashboardTheme } from "./theme";
import Toolbar from "./toolbar";
import Tooltip from "./tooltip";
import "./tokens.css";
import "./shell.css";
import "./responsive.css";
import "./controls.css";

type Props = {
  section: SettingsSection | null;
  account: ReactNode;
  children?: ReactNode;
  sidebar?: ReactNode;
  chatTitle?: ReactNode;
  notFound?: boolean;
  homeHref?: string;
};
const settingsLinks: { title: string; section: SettingsSection; icon: IconName }[] = [
  { title: "General", section: "general", icon: "sliders-horizontal" },
  { title: "Voice", section: "voice", icon: "mic" },
  { title: "Profile", section: "profile", icon: "square-pen" },
  { title: "Appearance", section: "appearance", icon: "wrench" },
  { title: "Account", section: "account", icon: "shield" },
];

export default function DashboardShell({
  section,
  account,
  children,
  sidebar,
  chatTitle,
  notFound = false,
  homeHref = "/dashboard",
}: Props) {
  const { sidebarOpen, rightOpen, fullView, rightRef, toggleSidebar, toggleRight, toggleFullView } =
    usePanes(section === null && !notFound);
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
  const title = settings ? "Settings" : notFound ? "Page not found" : "Dashboard";
  const visibleLinks = settingsLinks.filter((item) =>
    item.title.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <div
      ref={focusRef}
      data-dashboard
      data-theme={theme}
      style={paneStyle}
      data-sidebar-open={sidebarOpen}
      data-right-open={rightOpen}
      data-full-view={fullView}
    >
      <a
        href={fullView ? "#workspace-right" : "#dashboard-content"}
        data-cx="skip-link"
        data-skip="main"
      >
        Skip to content
      </a>
      {rightOpen && !fullView && (
        <a href="#workspace-right" data-cx="skip-link" data-skip="right">
          Skip to right section
        </a>
      )}
      <Toolbar
        title={settings || notFound ? title : ""}
        chatTitle={chatTitle}
        sidebarOpen={sidebarOpen && !fullView}
        rightOpen={rightOpen}
        fullView={fullView}
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
            aria-current={!settings && !notFound ? "page" : undefined}
          >
            <Icon name="house" />
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
      <aside id="workspace-sidebar" data-cx="sidebar" hidden={!sidebarOpen}>
        {settings ? (
          <>
            <div data-cx="sidebar-heading">
              <strong>Settings</strong>
            </div>
            <SearchField
              id="settings-search"
              label="Search settings"
              value={search}
              onChange={setSearch}
              status={`${visibleLinks.length} matching settings sections`}
            />
            <nav data-cx="sidebar-navigation" aria-label="Settings sections">
              {visibleLinks.map((item) => (
                <RouteLink
                  key={item.section}
                  href={`/settings/${item.section}`}
                  data-cx="nav-row"
                  aria-current={section === item.section ? "page" : undefined}
                >
                  <Icon name={item.icon} />
                  <span>{item.title}</span>
                </RouteLink>
              ))}
              {visibleLinks.length === 0 && (
                <output data-cx="search-empty">No matching settings.</output>
              )}
            </nav>
          </>
        ) : (
          (sidebar ?? null)
        )}
        {!fullView && (
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
        {rightOpen && !fullView && (
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
          {!settings && !notFound && <h1 className="sr-only">Dashboard</h1>}
          {children}
        </main>
        <section
          ref={rightRef}
          id="workspace-right"
          data-cx="right-section"
          aria-label="Right section"
          tabIndex={-1}
          hidden={!rightOpen}
        />
      </div>
    </div>
  );
}
