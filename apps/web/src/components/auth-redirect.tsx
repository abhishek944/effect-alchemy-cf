import { useEffect } from "react";
import { authContinuation } from "@/lib/public-auth-route";
import { navigate } from "@/lib/router";
import SessionPending from "./session-pending";

export default function AuthRedirect() {
  useEffect(() => {
    navigate(authContinuation(window.location), { replace: true });
  }, []);
  return <SessionPending message="Opening your workspace…" />;
}
