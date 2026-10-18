/**
 * Theme identity and the browser mirror used once for migration.
 *
 * The five ids are the whole palette and match the account schema; the browser
 * mirror is not an override, it only carries a pre-existing local preference
 * into the account the first time an account has no explicit value.
 */
import { parseThemeId, type AccountTheme } from "@/lib/account-validate";

export const DASHBOARD_THEMES = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "midnight-black", label: "Midnight Black" },
  { value: "dusk", label: "Dusk" },
  { value: "paper", label: "Paper" },
] as const satisfies readonly { value: AccountTheme; label: string }[];

export type DashboardTheme = AccountTheme;

export const DEFAULT_THEME: DashboardTheme = "dark";

const STORAGE_PREFIX = "effect-alchemy.dashboard-theme:";

export const parseDashboardTheme = (value: string | null): DashboardTheme | null =>
  parseThemeId(value);

export function readBrowserTheme(userId: string): DashboardTheme | null {
  try {
    return parseDashboardTheme(window.localStorage.getItem(`${STORAGE_PREFIX}${userId}`));
  } catch {
    return null;
  }
}

export function rememberBrowserTheme(userId: string, theme: DashboardTheme): void {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}${userId}`, theme);
  } catch {
    // The account record stays authoritative; the mirror is only a migration aid.
  }
}
