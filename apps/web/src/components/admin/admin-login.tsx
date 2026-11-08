import { SignIn } from "@clerk/react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Props = { notice?: string | null };

/**
 * Admin sign-in is ordinary Clerk sign-in; the server decides whether the
 * account carries the admin role. There is no bootstrap token any more, so the
 * Clerk dashboard is the only place a role is granted.
 */
export default function AdminLogin({ notice }: Props) {
  return (
    <Card className="w-full rounded-2xl border-border/80 bg-card shadow-[0_24px_80px_-44px_rgba(20,28,38,0.35)]">
      <CardHeader className="gap-2 px-7 pb-5 pt-7 sm:px-8 sm:pt-8">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Admin access
        </p>
        <CardTitle className="text-2xl tracking-tight">Sign in to the admin portal</CardTitle>
        <CardDescription>
          Sign in with an account whose Clerk public metadata carries{" "}
          <code className="font-mono">{'{"role":"admin"}'}</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="px-7 pb-7 sm:px-8 sm:pb-8">
        {notice && (
          <output className="mb-5 block rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-muted-foreground">
            {notice}
          </output>
        )}
        <SignIn routing="hash" appearance={{ variables: { colorPrimary: "inherit" } }} />
      </CardContent>
    </Card>
  );
}
