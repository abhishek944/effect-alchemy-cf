import { lazy, Suspense, useState } from "react";
import AdminPortal from "@/components/admin/admin-portal";
import AuthRedirect from "@/components/auth-redirect";
import Workspace from "@/components/dashboard/workspace";
import SessionPending from "@/components/session-pending";
import { authClient } from "@/lib/auth-client";
import { isPublicAuthPath } from "@/lib/public-auth-route";
import { usePathname } from "@/lib/router";

const PublicPages = lazy(() => import("@/components/public/public-pages"));

export default function App() {
  const pathname = usePathname();
  const { data: session, isPending, error } = authClient.useSession();
  const [checkedSession, setCheckedSession] = useState(!isPending);
  if (!checkedSession && !isPending) setCheckedSession(true);
  const isAdminRoute = pathname === "/admin" || pathname.startsWith("/admin/");

  if (isAdminRoute) return <AdminPortal />;
  if (session) {
    if (isPublicAuthPath(pathname)) return <AuthRedirect />;
    return <Workspace user={session.user} pathname={pathname} />;
  }
  // A background anonymous-session refresh must not tear down the public page.
  if (!checkedSession && isPending && !isPublicAuthPath(pathname)) return <SessionPending />;
  return (
    <Suspense fallback={<SessionPending message="Loading page…" />}>
      <PublicPages pathname={pathname} checking={isPending} sessionError={error ?? null} />
    </Suspense>
  );
}
