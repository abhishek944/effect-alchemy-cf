/**
 * The admin surface owns its origin root, so a home action must leave for the main
 * site. The main surface keeps the same-origin home and client-side navigation.
 */
export const adminHomeHref = PUBLIC_MAIN_SITE_URL || "/";

/**
 * Public sign-up lives on the main site: the admin origin leaves for it, while the
 * main surface keeps the path. Clerk needs it explicitly, because a missing URL sends
 * its own sign-up navigation to the hosted Account Portal instead of the main site.
 */
export const publicSignUpHref = PUBLIC_MAIN_SITE_URL ? `${PUBLIC_MAIN_SITE_URL}/signup` : "/signup";
