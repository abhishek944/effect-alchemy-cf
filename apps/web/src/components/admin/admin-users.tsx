import { type FormEvent, useState } from "react";
import AdminUserDetails from "@/components/admin/admin-user-details";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  AdminApiError,
  type AdminIdentity,
  type AdminRole,
  type AdminUser,
  adminErrorMessage,
  searchUserByEmail,
  updateUserRole,
} from "@/lib/admin-api";

type Props = {
  identity: AdminIdentity;
  onAccessLost: (status: number) => void;
  onIdentityChanged: () => void;
};

type Status = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "error" | "info"; message: string };

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  const palette =
    feedback.tone === "error"
      ? "border-destructive/30 bg-destructive/5 text-destructive"
      : "border-border bg-muted/60 text-muted-foreground";
  return (
    <output className={`block rounded-lg border px-3 py-2 text-sm ${palette}`}>
      {feedback.message}
    </output>
  );
}

export default function AdminUsers({ identity, onAccessLost, onIdentityChanged }: Props) {
  const [email, setEmail] = useState("");
  const [searchedEmail, setSearchedEmail] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [user, setUser] = useState<AdminUser | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [rolePending, setRolePending] = useState(false);

  const runSearch = async (target: string) => {
    setStatus("loading");
    setFeedback(null);
    try {
      const found = await searchUserByEmail(target);
      setUser(found);
      setSearchedEmail(target);
      setStatus("ready");
    } catch (caught) {
      if (caught instanceof AdminApiError && (caught.status === 401 || caught.status === 403)) {
        onAccessLost(caught.status);
        return;
      }
      setStatus("error");
      setFeedback({ tone: "error", message: adminErrorMessage(caught) });
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const target = email.trim();
    if (!target) {
      setStatus("error");
      setFeedback({ tone: "error", message: "Enter the full email address to search." });
      return;
    }
    setEmail(target);
    void runSearch(target);
  };

  const changeRole = async (nextRole: AdminRole) => {
    if (!user) return;
    setRolePending(true);
    setFeedback(null);
    try {
      await updateUserRole(user.id, nextRole);
      setUser({ ...user, role: nextRole });
      setFeedback({ tone: "info", message: `Role updated to ${nextRole}.` });
      if (user.id === identity.id) onIdentityChanged();
    } catch (caught) {
      if (
        caught instanceof AdminApiError &&
        caught.status === 403 &&
        user.id === identity.id &&
        nextRole !== "admin"
      ) {
        setFeedback({
          tone: "error",
          message: "The server blocks demoting your own admin account to prevent lockout.",
        });
        return;
      }
      if (caught instanceof AdminApiError && (caught.status === 401 || caught.status === 403)) {
        onAccessLost(caught.status);
        return;
      }
      setFeedback({ tone: "error", message: adminErrorMessage(caught) });
    } finally {
      setRolePending(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Look up an account by its exact email address and manage its role.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exact email lookup</CardTitle>
          <CardDescription>
            Search is an exact match. Partial addresses return no results.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <form className="flex flex-col gap-3 sm:flex-row" onSubmit={handleSubmit}>
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium" htmlFor="admin-user-email">
                Email address
              </label>
              <Input
                id="admin-user-email"
                name="email"
                type="email"
                autoComplete="off"
                placeholder="person@example.com"
                value={email}
                disabled={status === "loading" || rolePending}
                onChange={(event) => setEmail(event.target.value)}
              />
            </div>
            <Button
              className="sm:mt-[26px]"
              type="submit"
              disabled={status === "loading" || rolePending}
            >
              {status === "loading" ? "Searching…" : "Search"}
            </Button>
          </form>
          {feedback && <FeedbackBanner feedback={feedback} />}
        </CardContent>
      </Card>
      {status === "loading" && (
        <output
          className="flex items-center gap-3 text-sm text-muted-foreground"
          aria-live="polite"
        >
          <span
            className="size-4 animate-spin rounded-full border-2 border-current border-r-transparent"
            aria-hidden="true"
          />
          Looking up the account…
        </output>
      )}
      {status === "idle" && (
        <p className="text-sm text-muted-foreground">
          Enter an email address above to see account details.
        </p>
      )}
      {status === "ready" && !user && (
        <Card>
          <CardContent className="py-10 text-center">
            <p className="text-sm font-medium">No account found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Nothing matches <span className="font-medium text-foreground">{searchedEmail}</span>{" "}
              exactly. Check the spelling and try again.
            </p>
          </CardContent>
        </Card>
      )}
      {status === "ready" && user && (
        <AdminUserDetails
          user={user}
          isSelf={user.id === identity.id}
          rolePending={rolePending}
          onChangeRole={(role) => void changeRole(role)}
        />
      )}
    </div>
  );
}
