import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { AdminApiError, adminErrorMessage, adminOtaLogin } from "@/lib/admin-api";
import { authClient } from "@/lib/auth-client";

type Props = { notice?: string | null; onAuthenticated: () => void };
type Mode = "ota" | "password";

function readValue(values: FormData, key: string): string {
  const value = values.get(key);
  return typeof value === "string" ? value : "";
}

export default function AdminLogin({ notice, onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("ota");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
  };

  const handleOta = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const token = readValue(new FormData(event.currentTarget), "token").trim();
    if (!token) {
      setError("Paste the one-time access token to continue.");
      return;
    }
    setPending(true);
    try {
      await adminOtaLogin(token);
      onAuthenticated();
    } catch (caught) {
      setError(
        caught instanceof AdminApiError && caught.status === 401
          ? "That one-time access token is invalid, expired, or already used."
          : adminErrorMessage(caught),
      );
    } finally {
      setPending(false);
    }
  };

  const handlePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    const values = new FormData(event.currentTarget);
    setPending(true);
    try {
      const { error: signInError } = await authClient.signIn.email({
        email: readValue(values, "email").trim(),
        password: readValue(values, "password"),
      });
      if (signInError) {
        setError(signInError.message || "Unable to sign in. Check your email and password.");
        return;
      }
      onAuthenticated();
    } catch (caught) {
      setError(adminErrorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <Card className="w-full rounded-2xl border-border/80 bg-card shadow-[0_24px_80px_-44px_rgba(20,28,38,0.35)]">
      <CardHeader className="gap-2 px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Admin access
        </p>
        <CardTitle className="text-2xl tracking-tight">Sign in to the admin portal</CardTitle>
        <CardDescription>
          Use a one-time access token for bootstrap, or sign in with an email and password that has
          the admin role.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 px-7 pb-7 sm:px-8 sm:pb-8">
        {notice && (
          <output className="block rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {notice}
          </output>
        )}
        <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted p-1">
          <Button
            type="button"
            size="sm"
            variant={mode === "ota" ? "default" : "ghost"}
            aria-pressed={mode === "ota"}
            disabled={pending}
            onClick={() => switchMode("ota")}
          >
            One-time access
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "password" ? "default" : "ghost"}
            aria-pressed={mode === "password"}
            disabled={pending}
            onClick={() => switchMode("password")}
          >
            Email &amp; password
          </Button>
        </div>
        {error && (
          <p
            className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            role="alert"
          >
            {error}
          </p>
        )}
        {mode === "ota" ? (
          <form className="space-y-4" onSubmit={(event) => void handleOta(event)}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="admin-ota-token">
                One-time access token
              </label>
              <Input
                id="admin-ota-token"
                name="token"
                type="password"
                className="font-mono"
                autoComplete="one-time-code"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="Paste the 64-character token"
                aria-describedby="admin-ota-token-hint"
                required
                disabled={pending}
              />
              <p id="admin-ota-token-hint" className="text-xs text-muted-foreground">
                Tokens are single use and expire quickly. An expired or revoked token must be
                replaced.
              </p>
            </div>
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? "Verifying token…" : "Continue with token"}
            </Button>
          </form>
        ) : (
          <form className="space-y-4" onSubmit={(event) => void handlePassword(event)}>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="admin-email">
                Email
              </label>
              <Input
                id="admin-email"
                name="email"
                type="email"
                autoComplete="email"
                required
                disabled={pending}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium" htmlFor="admin-password">
                Password
              </label>
              <Input
                id="admin-password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={pending}
              />
            </div>
            <Button className="w-full" type="submit" disabled={pending}>
              {pending ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
