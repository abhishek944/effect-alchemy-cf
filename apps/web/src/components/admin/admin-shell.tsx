import type { ReactNode } from "react";
import AdminMobileNav from "@/components/admin/admin-mobile-nav";
import AdminSidebarContent, { type SidebarProps } from "@/components/admin/admin-sidebar-content";

type ShellProps = SidebarProps & { children: ReactNode };

export default function AdminShell({
  identity,
  active,
  signOutPending,
  onSignOut,
  children,
}: ShellProps) {
  return (
    <div className="min-h-svh bg-background text-foreground lg:flex">
      <aside className="sticky top-0 hidden h-svh w-64 shrink-0 border-r border-border bg-card lg:block">
        <AdminSidebarContent
          identity={identity}
          active={active}
          signOutPending={signOutPending}
          onSignOut={onSignOut}
        />
      </aside>
      <AdminMobileNav>
        <AdminSidebarContent
          identity={identity}
          active={active}
          signOutPending={signOutPending}
          onSignOut={onSignOut}
        />
      </AdminMobileNav>
      <main className="min-w-0 flex-1 px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
    </div>
  );
}
