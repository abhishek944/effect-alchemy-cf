import { useState } from "react";
import AccountSession from "@/components/account-session";
import AuthForm, { type AuthMode } from "@/components/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { authClient } from "@/lib/auth-client";

export default function AuthPanel() {
  const { data: session, isPending, error } = authClient.useSession();
  const [mode, setMode] = useState<AuthMode>("sign-in");

  return (
    <Card className="w-full rounded-2xl border-border/80 bg-card shadow-[0_24px_80px_-44px_rgba(20,28,38,0.35)]">
      <CardHeader className="gap-2 px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Member access
        </p>
        <CardTitle className="text-2xl tracking-tight">
          {session ? "You're all set" : mode === "sign-up" ? "Create your account" : "Welcome back"}
        </CardTitle>
        <CardDescription>
          {session
            ? "Your session is active on this device."
            : mode === "sign-up"
              ? "A few details and you're ready to go."
              : "Sign in with your email and password."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-7 pb-7 sm:px-8 sm:pb-8">
        {isPending ? (
          <output
            className="flex items-center gap-3 py-5 text-sm text-muted-foreground"
            aria-live="polite"
          >
            <span
              className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
              aria-hidden="true"
            />
            Checking your session…
          </output>
        ) : session ? (
          <AccountSession name={session.user.name} email={session.user.email} />
        ) : (
          <div className="space-y-5">
            {error && (
              <p
                className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                Could not check your session: {error.message || "Please try again."}
              </p>
            )}
            <AuthForm mode={mode} onModeChange={setMode} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
