/// <reference types="vite/client" />

import type { PublicAppConfig } from "@highchat/config/public";

declare global {
  const PUBLIC_APP_CONFIG: PublicAppConfig;
  /** Build-time surface choice: the main site or the separately served admin origin. */
  const PUBLIC_APP_SURFACE: "main" | "admin";
  /** Main-site origin for cross-origin links; blank when the admin surface is not built. */
  const PUBLIC_MAIN_SITE_URL: string;
  /** Clerk publishable key; blank when the instance is not configured. */
  const PUBLIC_CLERK_PUBLISHABLE_KEY: string;
}
