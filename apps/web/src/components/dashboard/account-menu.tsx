import RouteLink from "@/lib/route-link";
import { useEffect, useId, useRef, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Icon, type IconName } from "./icon";
import { type DashboardUser } from "./model";
import { requestLeave } from "./account-leave-guard";
import ErrorNotice from "./error-notice";
import { useAccountProfile } from "./profile-context";
import "./account.css";

const accountLinks = [
  { href: "/settings/general", icon: "settings", label: "Settings" },
] satisfies { href: string; icon: IconName; label: string }[];

/** Saved private photo when one exists, initials otherwise. */
function Avatar({ profile }: { profile: ReturnType<typeof useAccountProfile> }) {
  if (profile.photoUrl === null)
    return (
      <span data-cx="avatar" aria-hidden="true">
        {profile.initials}
      </span>
    );
  return <img data-cx="avatar" src={profile.photoUrl} alt="" aria-hidden="true" />;
}

export default function AccountMenu({ user }: { user: DashboardUser }) {
  const popoverId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const signOutRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Native popover events keep the trigger's expanded state current and return
  // focus to the trigger whenever the popover closes with focus still inside it.
  useEffect(() => {
    const popover = popoverRef.current;
    if (!popover) return undefined;
    const handleToggle = (event: Event) => {
      if (!(event instanceof ToggleEvent)) return;
      setOpen(event.newState === "open");
      if (event.newState === "closed" && popover.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
    };
    popover.addEventListener("toggle", handleToggle);
    return () => popover.removeEventListener("toggle", handleToggle);
  }, []);

  const close = () => {
    popoverRef.current?.hidePopover();
  };

  const signOut = async () => {
    setFeedback(null);
    setPending(true);
    try {
      const { error } = await authClient.signOut();
      if (error) {
        setFeedback(error.message || "Unable to sign out. Please try again.");
      } else {
        close();
      }
    } catch {
      setFeedback("The server did not respond. Check your connection before trying again.");
    } finally {
      setPending(false);
    }
  };

  /**
   * Every sign-out affordance goes through this guard: signing out ends the
   * session and removes the workspace, so a dirty profile draft defers the action
   * to the leave dialog instead of being dropped.
   */
  const guardedSignOut = () => {
    const leave = { intent: { kind: "signout" } as const, action: () => void signOut() };
    // True means no dirty-form guard owns the transition, so the action must run
    // now; false means the leave dialog owns it and will run it exactly once.
    if (requestLeave(leave)) leave.action();
  };

  const profile = useAccountProfile();
  const displayName = profile.saved === null ? user.name : profile.displayName;

  return (
    <div data-cx="account">
      <button
        ref={triggerRef}
        type="button"
        data-cx="account-trigger"
        popoverTarget={popoverId}
        aria-label={`Account for ${displayName}`}
        aria-controls={popoverId}
        aria-expanded={open}
      >
        <Avatar profile={profile} />
      </button>
      <section
        ref={popoverRef}
        id={popoverId}
        popover="auto"
        tabIndex={-1}
        data-cx="account-popover"
        aria-label={`Account for ${displayName}`}
      >
        <RouteLink
          href="/settings/profile"
          data-cx="account-header"
          aria-label={`Open profile for ${displayName}`}
          onClick={close}
        >
          <Avatar profile={profile} />
          <span data-cx="account-header-text">
            <span data-cx="account-header-name">{displayName}</span>
            <span data-cx="account-header-email">{user.email}</span>
          </span>
        </RouteLink>
        <div data-cx="account-separator" role="presentation" />
        {accountLinks.map((link) => (
          <RouteLink key={link.href} href={link.href} data-cx="account-row" onClick={close}>
            <Icon name={link.icon} />
            <span>{link.label}</span>
          </RouteLink>
        ))}
        <div data-cx="account-separator" role="presentation" />
        <button
          ref={signOutRef}
          type="button"
          data-cx="account-row"
          aria-busy={pending}
          disabled={pending}
          onClick={guardedSignOut}
        >
          <Icon name="log-out" />
          <span>{pending ? "Signing out…" : "Log out"}</span>
        </button>
        {feedback ? (
          <div data-cx="account-error-host">
            <ErrorNotice
              title="Couldn’t confirm sign-out"
              message={feedback}
              action={{
                label: "Try signing out",
                onClick: () => {
                  popoverRef.current?.focus();
                  guardedSignOut();
                },
                disabled: pending,
              }}
              onDismiss={() => {
                signOutRef.current?.focus();
                setFeedback(null);
              }}
              dismissLabel="Dismiss sign-out error"
            />
          </div>
        ) : null}
      </section>
    </div>
  );
}
