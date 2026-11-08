/// <reference types="vite/client" />

import type { PublicAppConfig } from "@highchat/config/public";

declare global {
  const PUBLIC_APP_CONFIG: PublicAppConfig;
  /** Blank unless a local admin origin must link home to the main UI. */
  const PUBLIC_ADMIN_HOME_URL: string;
  /** Clerk publishable key; blank when the instance is not configured. */
  const PUBLIC_CLERK_PUBLISHABLE_KEY: string;
}
