/**
 * Settings route registry.
 *
 * The shell navigation and the workspace resolver read this one list, so a
 * section cannot exist in the sidebar without resolving to its panel.
 */
import type { SettingsSection } from "./model";

export type SettingsRoute = {
  readonly section: SettingsSection;
  readonly title: string;
  readonly href: string;
};

export const SETTINGS_ROUTES: readonly SettingsRoute[] = [
  { section: "general", title: "General", href: "/settings/general" },
  { section: "voice", title: "Voice", href: "/settings/voice" },
  { section: "images", title: "Images", href: "/settings/images" },
  { section: "skills", title: "Skills", href: "/settings/skills" },
  { section: "profile", title: "Profile", href: "/settings/profile" },
  { section: "appearance", title: "Appearance", href: "/settings/appearance" },
  { section: "account", title: "Account", href: "/settings/account" },
];

/** `/settings` opens General, exactly as before; unknown paths resolve to null. */
export function settingsSectionFromPath(pathname: string): SettingsSection | null {
  return (
    SETTINGS_ROUTES.find((route) => route.href === pathname)?.section ??
    (pathname === "/settings" ? "general" : null)
  );
}
