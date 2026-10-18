import type { MouseEvent, ReactNode } from "react";
import AdminLogin from "@/components/admin/admin-login";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { navigate } from "@/lib/router";

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh place-items-center bg-background px-6 py-12 text-foreground">
      {children}
    </div>
  );
}

function backHome(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  navigate("/");
}

function BackHomeLink({ asButton = false }: { asButton?: boolean }) {
  if (asButton) {
    return (
      <Button className="w-full" variant="ghost" asChild>
        <a href="/" onClick={backHome}>
          Back to home
        </a>
      </Button>
    );
  }
  return (
    <a
      className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
      href="/"
      onClick={backHome}
    >
      Back to home
    </a>
  );
}

export function CheckingScreen() {
  return (
    <Centered>
      <output className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
        <span
          className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
          aria-hidden="true"
        />
        Checking admin access…
      </output>
    </Centered>
  );
}

export function LoginScreen({
  notice,
  onAuthenticated,
}: {
  notice: string | null;
  onAuthenticated: () => void;
}) {
  return (
    <Centered>
      <div className="w-full max-w-md space-y-4">
        <AdminLogin notice={notice} onAuthenticated={onAuthenticated} />
        <BackHomeLink />
      </div>
    </Centered>
  );
}

export function UnavailableScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Admin tools unavailable</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button className="w-full" onClick={onRetry}>
            Try again
          </Button>
          <BackHomeLink />
        </CardContent>
      </Card>
    </Centered>
  );
}

export function DeniedScreen({
  notice,
  actionError,
  signOutPending,
  onUseToken,
  onSignOut,
}: {
  notice: string;
  actionError: string | null;
  signOutPending: boolean;
  onUseToken: () => void;
  onSignOut: () => void;
}) {
  return (
    <Centered>
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Admin access required</CardTitle>
          <CardDescription>{notice}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {actionError && (
            <p
              className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {actionError}
            </p>
          )}
          <Button className="w-full" onClick={onUseToken}>
            Use one-time access
          </Button>
          <Button
            className="w-full"
            variant="outline"
            disabled={signOutPending}
            onClick={onSignOut}
          >
            {signOutPending ? "Signing out…" : "Sign out"}
          </Button>
          <BackHomeLink asButton />
        </CardContent>
      </Card>
    </Centered>
  );
}
