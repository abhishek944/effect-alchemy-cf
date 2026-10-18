import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AdminRole, AdminUser } from "@/lib/admin-api";

type Props = {
  user: AdminUser;
  isSelf: boolean;
  rolePending: boolean;
  onChangeRole: (role: AdminRole) => void;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all text-sm font-medium sm:text-right">{children}</dd>
    </div>
  );
}

export default function AdminUserDetails({ user, isSelf, rolePending, onChangeRole }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{user.name || user.email}</CardTitle>
        <CardDescription>{user.email}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <dl>
          <DetailRow label="User ID">
            <span className="font-mono text-xs">{user.id}</span>
          </DetailRow>
          <DetailRow label="Email verified">{user.emailVerified ? "Yes" : "No"}</DetailRow>
          <DetailRow label="Created">
            <time dateTime={user.createdAt}>{formatDate(user.createdAt)}</time>
          </DetailRow>
          <DetailRow label="Updated">
            <time dateTime={user.updatedAt}>{formatDate(user.updatedAt)}</time>
          </DetailRow>
        </dl>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-muted/60 p-3">
          <span className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {user.role}
          </span>
          {user.role === "admin" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={rolePending || isSelf}
              onClick={() => onChangeRole("user")}
            >
              {rolePending ? "Updating…" : "Demote to user"}
            </Button>
          ) : (
            <Button size="sm" disabled={rolePending} onClick={() => onChangeRole("admin")}>
              {rolePending ? "Updating…" : "Promote to admin"}
            </Button>
          )}
          {isSelf && (
            <p className="text-xs text-muted-foreground">
              You cannot demote your own account; the server blocks self-demotion to prevent
              lockout.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
