/// <reference types="vite/client" />

import type { PublicAppConfig } from "@highchat/config/public";

declare global {
  const PUBLIC_APP_CONFIG: PublicAppConfig;
}
