/**
 * Account-backed dashboard theme provider.
 *
 * The state machine lives in `use-account-theme`: it fences reads and writes,
 * re-reads authoritative state after a conflict or an uncertain outcome, keeps a
 * rejected choice only for an explicit Retry, preserves a pending migration
 * candidate, and re-reads when the chat stream reports a settled run or a
 * re-established connection. The visible Appearance layout and the quiet
 * control-level note slot are unchanged, and there is no notification surface.
 */
import { createContext, useContext, type ReactNode } from "react";
import { useAccountTheme, type AccountThemeState } from "./use-account-theme";
import { DASHBOARD_THEMES, parseDashboardTheme, type DashboardTheme } from "./theme-storage";

export { DASHBOARD_THEMES, parseDashboardTheme };
export type { DashboardTheme };

const DashboardThemeContext = createContext<AccountThemeState | null>(null);

export function DashboardThemeProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const value = useAccountTheme(userId);
  return <DashboardThemeContext.Provider value={value}>{children}</DashboardThemeContext.Provider>;
}

export function useDashboardTheme(): AccountThemeState {
  const value = useContext(DashboardThemeContext);
  if (!value) {
    throw new Error("useDashboardTheme requires DashboardThemeProvider");
  }
  return value;
}
