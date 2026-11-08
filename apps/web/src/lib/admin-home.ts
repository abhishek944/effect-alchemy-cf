/**
 * Local admin development uses its own origin, so a home action must leave for the
 * main UI. Production keeps the same-origin home and client-side navigation.
 */
export const adminHomeHref = PUBLIC_ADMIN_HOME_URL || "/";
