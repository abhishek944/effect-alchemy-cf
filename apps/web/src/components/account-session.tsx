import { useState } from "react";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";

type Props = { name: string; email: string };

function errorMessage(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : "Something went wrong. Please try again.";
}

export default function AccountSession({ name, email }: Props) {
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const handleSignOut = async () => {
    setFeedback(null);
    setPending(true);
    try {
      const { error } = await authClient.signOut();
      if (error) setFeedback(error.message || "Unable to sign out. Please try again.");
    } catch (error) {
      setFeedback(errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-xl border border-border bg-muted/60 p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-background text-sm font-semibold text-primary">
          {(name || email).slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name || "Signed-in account"}</p>
          <p className="truncate text-sm text-muted-foreground">{email}</p>
        </div>
      </div>
      {feedback && (
        <p className="text-sm text-destructive" role="alert">
          {feedback}
        </p>
      )}
      <Button
        className="w-full"
        variant="outline"
        onClick={() => void handleSignOut()}
        disabled={pending}
      >
        {pending ? "Signing out…" : "Sign out"}
      </Button>
    </div>
  );
}
