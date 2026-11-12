import { useEffect } from "react";
import AuthPage from "@/components/auth-page";
import LandingPage from "./landing-page";
import { PUBLIC_SITE_NAME } from "./public-brand";
import { authModePath } from "@/lib/public-auth-route";
import { navigate } from "@/lib/router";
import "./styles/public.css";

export default function PublicPages({
  pathname,
  checking,
  sessionError,
}: {
  pathname: string;
  checking: boolean;
  sessionError: string | null;
}) {
  useEffect(() => {
    // Route links keep the document alive; start the new page at its introduction.
    // Leave native fragment navigation (including section links) to the browser.
    if (!window.location.hash) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    const previous = document.title;
    document.title =
      pathname === "/"
        ? PUBLIC_SITE_NAME
        : `${pathname === "/signup" ? "Create account" : "Sign in"} · ${PUBLIC_SITE_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [pathname]);
  if (pathname === "/") return <LandingPage />;
  return (
    <AuthPage
      mode={pathname === "/signup" ? "sign-up" : "sign-in"}
      checking={checking}
      sessionError={sessionError}
      homeHref="/"
      signInHref={authModePath("sign-in", window.location)}
      signUpHref={authModePath("sign-up", window.location)}
      onModeChange={(next) => navigate(authModePath(next, window.location))}
    />
  );
}
