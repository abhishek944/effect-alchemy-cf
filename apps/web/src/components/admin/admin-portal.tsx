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
import { authClient } from "@/lib/auth-client";
import { navigate, usePathname } from "@/lib/router";

type AccessState =
  | { kind: "checking" }
  | { kind: "unauthenticated"; notice: string | null }
  | { kind: "forbidden"; notice: string | null }
  | { kind: "unavailable"; message: string }
  | { kind: "ready"; identity: AdminIdentity };

const SESSION_ENDED = "Your admin session ended or was revoked. Sign in again to continue.";
const NOT_ADMIN =
  "The signed-in account does not have the admin role on the server. Sign in with an admin account or use a one-time access token.";

// Server-side check; every admin render is gated by this result, not client state.
async function loadAccess(): Promise<AccessState> {
  try {
    const identity = await fetchAdminIdentity();
    return identity.role === "admin"
      ? { kind: "ready", identity }
      : { kind: "forbidden", notice: NOT_ADMIN };
  } catch (caught) {
    if (caught instanceof AdminApiError && caught.status === 401) {
      return { kind: "unauthenticated", notice: null };
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
  apply: (next: AccessState) => void,
): Promise<void> {
  const next = await loadAccess();
  if (requestRef.current === requestId) apply(next);
}

export default function AdminPortal() {
  const pathname = usePathname();
  const [access, setAccess] = useState<AccessState>({ kind: "checking" });
  const [signOutPending, setSignOutPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Monotonic request id: only the newest server check may update access state.
  const requestRef = useRef(0);

  useEffect(() => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    void applyNewest(requestRef, requestId, setAccess);
    return () => {
      // Unmount or remount invalidates any in-flight check.
      requestRef.current += 1;
    };
  }, []);

  const refreshAccess = () => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setAccess({ kind: "checking" });
    setActionError(null);
    void applyNewest(requestRef, requestId, setAccess);
  };

  const handleAccessLost = useCallback((status: number) => {
    requestRef.current += 1;
    setAccess(
      status === 403
        ? { kind: "forbidden", notice: "Your admin access was revoked on the server." }
        : { kind: "unauthenticated", notice: SESSION_ENDED },
    );
  }, []);

  const handleSignOut = async () => {
    requestRef.current += 1;
    setSignOutPending(true);
    setActionError(null);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        setActionError(error.message || "Unable to sign out. Please try again.");
        return;
      }
      refreshAccess();
    } catch (caught) {
      setActionError(adminErrorMessage(caught));
    } finally {
      setSignOutPending(false);
    }
  };

  if (access.kind === "checking") return <CheckingScreen />;

  if (access.kind === "unauthenticated") {
    return <LoginScreen notice={access.notice} onAuthenticated={refreshAccess} />;
  }

  if (access.kind === "forbidden") {
    return (
      <DeniedScreen
        notice={access.notice ?? NOT_ADMIN}
        actionError={actionError}
        signOutPending={signOutPending}
        onUseToken={() => setAccess({ kind: "unauthenticated", notice: null })}
        onSignOut={() => void handleSignOut()}
      />
    );
  }

  if (access.kind === "unavailable") {
    return <UnavailableScreen message={access.message} onRetry={refreshAccess} />;
  }

  const knownSection =
    pathname === "/admin" || pathname === "/admin/users" || pathname.startsWith("/admin/users/");

  return (
    <AdminShell
      identity={access.identity}
      active="users"
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
      {knownSection ? (
        <AdminUsers
          identity={access.identity}
          onAccessLost={handleAccessLost}
          onIdentityChanged={refreshAccess}
        />
      ) : (
        <div className="max-w-xl space-y-4">
          <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">That admin page does not exist.</p>
          <Button onClick={() => navigate("/admin/users")}>Go to Users</Button>
        </div>
      )}
    </AdminShell>
  );
}
