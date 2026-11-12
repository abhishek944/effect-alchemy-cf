/**
 * Admin routes are rooted at the admin origin. The main site keeps its own
 * public and workspace paths, so these never carry an /admin prefix.
 */
export type AdminSection = "users";

export const ADMIN_ROUTES = { users: "/users" } as const satisfies Record<AdminSection, string>;

export const ADMIN_NAV: ReadonlyArray<{
  id: AdminSection;
  label: string;
  path: string;
}> = [{ id: "users", label: "Users", path: ADMIN_ROUTES.users }];

/** The origin root and the Users section render the portal; other paths are not found. */
export function adminSectionFromPath(pathname: string): AdminSection | null {
  const users = ADMIN_ROUTES.users;
  if (pathname === "/" || pathname === users || pathname.startsWith(`${users}/`)) return "users";
  return null;
}
