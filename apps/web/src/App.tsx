import { lazy, Suspense, useState } from "react";
import AuthRedirect from "@/components/auth-redirect";
import Workspace from "@/components/dashboard/workspace";
import SessionPending from "@/components/session-pending";
import { authClient } from "@/lib/auth-client";
import { isPublicAuthPath } from "@/lib/public-auth-route";
import { usePathname } from "@/lib/router";

const PublicPages = lazy(() => import("@/components/public/public-pages"));
// Admin code stays lazy and only the admin surface renders it.
const AdminPortal = lazy(() => import("@/components/admin/admin-portal"));

function MainSurface() {
  const pathname = usePathname();
  const { data: session, isPending, error } = authClient.useSession();
  const [checkedSession, setCheckedSession] = useState(!isPending);
  if (!checkedSession && !isPending) setCheckedSession(true);
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

function AdminSurface() {
  return (
    <Suspense fallback={<SessionPending message="Loading admin portal…" />}>
      <AdminPortal />
    </Suspense>
  );
}

/** The Vite mode chooses one surface; the main site never branches to admin UI. */
export default function App() {
  return PUBLIC_APP_SURFACE === "admin" ? <AdminSurface /> : <MainSurface />;
}
