import type { MouseEvent } from "react";
import { Button } from "@/components/ui/button";
import type { AdminIdentity } from "@/lib/admin-api";
import { navigate } from "@/lib/router";

export type SidebarSection = "users";

export type SidebarProps = {
  identity: AdminIdentity;
  active: SidebarSection;
  signOutPending: boolean;
  onSignOut: () => void;
};

const NAV_ITEMS: ReadonlyArray<{ id: SidebarSection; label: string; path: string }> = [
  { id: "users", label: "Users", path: "/admin/users" },
];

function UsersIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    </svg>
  );
}

function handleNav(event: MouseEvent<HTMLAnchorElement>, path: string) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  navigate(path);
}

export default function AdminSidebarContent({
  identity,
  active,
  signOutPending,
  onSignOut,
}: SidebarProps) {
  return (
    <div className="flex h-full flex-col gap-6 p-5">
      <a
        href="/"
        className="flex items-center gap-3 font-semibold tracking-tight"
        onClick={(event) => handleNav(event, "/")}
      >
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary text-sm text-primary-foreground">
          E
        </span>
        <span className="leading-tight">
          Effect Alchemy
          <span className="block text-xs font-medium text-muted-foreground">Admin portal</span>
        </span>
      </a>
      <nav className="flex-1 space-y-1" aria-label="Admin sections">
        {NAV_ITEMS.map((item) => (
          <Button
            key={item.id}
            asChild
            variant={active === item.id ? "default" : "ghost"}
            className="w-full justify-start"
          >
            <a
              href={item.path}
              aria-current={active === item.id ? "page" : undefined}
              onClick={(event) => handleNav(event, item.path)}
            >
              <UsersIcon />
              {item.label}
            </a>
          </Button>
        ))}
      </nav>
      <div className="space-y-3 rounded-xl border border-border bg-muted/60 p-3">
        <div className="flex items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-background text-sm font-semibold text-primary">
            {(identity.name || identity.email).slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{identity.name || "Admin"}</p>
            <p className="truncate text-xs text-muted-foreground">{identity.email}</p>
          </div>
        </div>
        <span className="inline-flex rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {identity.role}
        </span>
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={onSignOut}
          disabled={signOutPending}
        >
          {signOutPending ? "Signing out…" : "Sign out"}
        </Button>
      </div>
    </div>
  );
}
