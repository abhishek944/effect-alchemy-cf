export type DashboardUser = { id: string; name: string; email: string };
export type SettingsSection =
  | "general"
  | "voice"
  | "images"
  | "skills"
  | "profile"
  | "appearance"
  | "account";

export function userInitials(user: DashboardUser): string {
  const name = user.name.trim();
  const words = name.split(/\s+/).filter(Boolean);
  return (
    words.length > 1
      ? `${words[0]?.[0] ?? ""}${words.at(-1)?.[0] ?? ""}`
      : (name || user.email || "User").slice(0, 2)
  ).toUpperCase();
}
