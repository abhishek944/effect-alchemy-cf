/**
 * Cross-component registry for leaving the Profile page with unsaved edits.
 *
 * The dirty draft lives inside the Profile form, but other surfaces can start a
 * destructive transition: the account menu signs out, the toolbar and the browser
 * change history. Those surfaces hand the transition to `requestLeave` as a
 * deferred action, so the single leave dialog owned by the form decides whether it
 * runs and the draft is never dropped silently.
 */
export type LeaveIntent =
  | { readonly kind: "route"; readonly path: string; readonly via: "link" | "history" }
  | { readonly kind: "signout" };

export type DeferredLeave = { readonly intent: LeaveIntent; readonly action: () => void };

type LeaveHandler = (leave: DeferredLeave) => boolean;

let handler: LeaveHandler | null = null;

/** Registers the mounted form's transition gate; returns its unregister function. */
export const registerLeaveGuard = (next: LeaveHandler): (() => void) => {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
};

/** True permits immediate execution; false means the form owns the transition. */
export const requestLeave = (leave: DeferredLeave): boolean =>
  handler === null ? true : handler(leave);
