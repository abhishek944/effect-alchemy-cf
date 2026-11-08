import RouteLink from "@/lib/route-link";
import { chatIdFromPath, isChatLanding } from "@/lib/chat-route";
import AccountMenu from "./account-menu";
import ChatPanel from "./chat-panel";
import ChatSidebar from "./chat-sidebar";
import ChatStoreProvider from "./chat-store";
import ChatToolbarTitle from "./chat-toolbar-title";
import type { DashboardUser } from "./model";
import { AccountProfileProvider } from "./profile-context";
import { settingsSectionFromPath } from "./routes";
import SettingsPanel from "./settings-panel";
import DashboardShell from "./shell";
import SubscriptionPage from "./subscription-page";
import { DashboardThemeProvider } from "./theme";
import { WorkspacePreviewProvider } from "./workspace-preview-context";
import { ReferenceWorkspaceProvider } from "./reference-workspace";
import { WorkspaceNavigationProvider } from "./workspace-navigation";

export default function Workspace({ user, pathname }: { user: DashboardUser; pathname: string }) {
  const section = settingsSectionFromPath(pathname);
  const subscription = pathname === "/subscription";
  const dashboard = isChatLanding(pathname) || chatIdFromPath(pathname) !== null;
  return (
    <DashboardThemeProvider key={user.id} userId={user.id}>
      <AccountProfileProvider key={user.id} user={user}>
        <WorkspaceNavigationProvider>
          <ReferenceWorkspaceProvider>
            <ChatStoreProvider key={user.id} pathname={pathname} accountId={user.id}>
              <WorkspacePreviewProvider active={dashboard} accountId={user.id}>
                <DashboardShell
                  accountId={user.id}
                  section={section}
                  subscription={subscription}
                  homeHref={chatIdFromPath(pathname) ? pathname : "/dashboard"}
                  account={<AccountMenu user={user} />}
                  sidebar={dashboard ? <ChatSidebar /> : undefined}
                  chatTitle={dashboard ? <ChatToolbarTitle /> : undefined}
                  notFound={!section && !subscription && !dashboard}
                >
                  <div data-cx="chat-page" hidden={!dashboard}>
                    <ChatPanel active={dashboard} />
                  </div>
                  {subscription ? (
                    <SubscriptionPage />
                  ) : section ? (
                    <SettingsPanel user={user} section={section} />
                  ) : !dashboard ? (
                    <section className="mx-auto max-w-xl px-8 py-16">
                      <h1 className="text-2xl font-semibold">Page not found</h1>
                      <p className="mt-3">This page has not been added to the workspace.</p>
                      <RouteLink href="/dashboard" className="mt-6 inline-block underline">
                        Back to dashboard
                      </RouteLink>
                    </section>
                  ) : null}
                </DashboardShell>
              </WorkspacePreviewProvider>
            </ChatStoreProvider>
          </ReferenceWorkspaceProvider>
        </WorkspaceNavigationProvider>
      </AccountProfileProvider>
    </DashboardThemeProvider>
  );
}
