import { useAuth } from "@clerk/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckingScreen,
  DeniedScreen,
  LoginScreen,
  UnavailableScreen,
} from "@/components/admin/admin-gate";
import AdminShell from "@/components/admin/admin-shell";
import AdminUsers from "@/components/admin/admin-users";
import { Button } from "@/components/ui/button";
import {
  AdminApiError,
  type AdminIdentity,
  adminErrorMessage,
  fetchAdminIdentity,
} from "@/lib/admin-api";
import { ADMIN_ROUTES, adminSectionFromPath } from "@/lib/admin-routes";
import { useSignOut } from "@/lib/auth-client";
import { navigate, usePathname } from "@/lib/router";

type AccessState =
  | { kind: "checking" }
  | { kind: "unauthenticated"; notice: string | null }
  | { kind: "forbidden"; notice: string | null }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; identity: AdminIdentity };

const SESSION_UNVERIFIED =
  "The server could not verify your sign-in. Try again, or return home to check your session.";
const NOT_ADMIN =
  "This account does not have admin access. Sign in with an admin account, or contact an administrator if you need it.";

// Server-side check; every admin render is gated by this result, not client state.
async function loadAccess(signedIn: boolean): Promise<AccessState> {
  if (!signedIn) return { kind: "unauthenticated", notice: null };
  try {
    const identity = await fetchAdminIdentity();
    return identity.role === "admin"
      ? { kind: "ready", identity }
      : { kind: "forbidden", notice: NOT_ADMIN };
  } catch (caught) {
    if (caught instanceof AdminApiError && caught.status === 401) {
      return { kind: "unavailable", message: SESSION_UNVERIFIED };
    }
    if (caught instanceof AdminApiError && caught.status === 403) {
      return { kind: "forbidden", notice: NOT_ADMIN };
    }
    return { kind: "unavailable", message: adminErrorMessage(caught) };
  }
}

type RequestRef = { current: number };

// Applies a finished server check only when it is still the newest request.
async function applyNewest(
  requestRef: RequestRef,
  requestId: number,
  signedIn: boolean,
  apply: (next: AccessState) => void,
): Promise<void> {
  const next = await loadAccess(signedIn);
  if (requestRef.current === requestId) apply(next);
}

export default function AdminPortal() {
  const { isLoaded, isSignedIn, userId, sessionId } = useAuth();
  // Mounting SignIn before hydration can redirect an already signed-in session,
  // reloading this page before its server-side access check can finish.
  if (!isLoaded) return <CheckingScreen />;
  return <SessionAdminPortal key={JSON.stringify([userId, sessionId])} signedIn={isSignedIn} />;
}

function SessionAdminPortal({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [access, setAccess] = useState<AccessState>({ kind: "checking" });
  const [signOutPending, setSignOutPending] = useState(false);
  const clerkSignOut = useSignOut();
  const [actionError, setActionError] = useState<string | null>(null);
  // Monotonic request id: only the newest server check may update access state.
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    void applyNewest(requestRef, requestId, signedIn, setAccess);
    return () => {
      // Unmount or remount invalidates any in-flight check.
      requestRef.current += 1;
    };
  }, [signedIn]);

  const refreshAccess = () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setAccess({ kind: "checking" });
    setActionError(null);
    void applyNewest(requestRef, requestId, signedIn, setAccess);
  };

  const handleAccessLost = useCallback((status: number) => {
    requestRef.current += 1;
    setAccess(
      status === 403
        ? { kind: "forbidden", notice: "Your admin access was revoked on the server." }
        : { kind: "unavailable", message: SESSION_UNVERIFIED },
    );
  }, []);

  const handleSignOut = async () => {
    requestRef.current += 1;
    setSignOutPending(true);
    setActionError(null);
    try {
      await clerkSignOut();
      refreshAccess();
    } catch {
      setActionError("Unable to sign out. Please try again.");
    } finally {
      setSignOutPending(false);
    }
  };

  if (access.kind === "checking") return <CheckingScreen />;

  if (access.kind === "unauthenticated") {
    return <LoginScreen notice={access.notice} />;
  }

  if (access.kind === "forbidden") {
    return (
      <DeniedScreen
        notice={access.notice ?? NOT_ADMIN}
        actionError={actionError}
        signOutPending={signOutPending}
        onSignOut={() => void handleSignOut()}
      />
    );
  }

  if (access.kind === "unavailable") {
    return <UnavailableScreen message={access.message} onRetry={refreshAccess} />;
  }

  const section = adminSectionFromPath(pathname);

  return (
    <AdminShell
      identity={access.identity}
      active={section}
      signOutPending={signOutPending}
      onSignOut={() => void handleSignOut()}
    >
      {actionError && (
        <p
          className="mb-6 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          role="alert"
        >
          {actionError}
        </p>
      )}
      {section ? (
        <AdminUsers
          identity={access.identity}
          onAccessLost={handleAccessLost}
          onIdentityChanged={refreshAccess}
        />
      ) : (
        <div className="max-w-xl space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">That admin page does not exist.</p>
          <Button onClick={() => navigate(ADMIN_ROUTES.users)}>Go to Users</Button>
        </div>
      )}
    </AdminShell>
  );
}
