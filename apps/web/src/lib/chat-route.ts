/** Public chat UUIDs, not the object-local Pi root session "1". */
const chatRoute = /^\/chat\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

export const chatIdFromPath = (pathname: string): string | null =>
  chatRoute.exec(pathname)?.[1] ?? null;

export const chatPath = (id: string): string => `/chat/${encodeURIComponent(id)}`;

export const isChatLanding = (pathname: string): boolean =>
  pathname === "/" || pathname === "/dashboard";
