/**
 * Focus capture and restoration for the leave guard.
 *
 * The guard remembers the control the user came from when it defers a navigation and
 * restores it whenever the dialog closes without navigating (Keep editing and the
 * automatic close after a publication settles). Restoration only moves focus to a
 * connected, visible and usable control, then to the display-name field, and finally
 * to the form root, which is programmatically focusable.
 */
export const isFocusable = (element: Element | null): element is HTMLElement =>
  element instanceof HTMLElement && element.tabIndex >= 0 && !element.hasAttribute("disabled");

const isUsable = (element: HTMLElement): boolean =>
  document.contains(element) && element.getClientRects().length > 0;

export const captureFocus = (): HTMLElement | null => {
  const active = document.activeElement;
  return isFocusable(active) && isUsable(active) ? active : null;
};

export const restoreFocus = (remembered: HTMLElement | null, root: HTMLElement | null): void => {
  if (remembered !== null && isFocusable(remembered) && isUsable(remembered)) {
    remembered.focus();
    return;
  }
  const field = root?.querySelector<HTMLElement>("#profile-name") ?? null;
  if (field !== null && isFocusable(field) && isUsable(field)) {
    field.focus();
    return;
  }
  if (root !== null && !root.hasAttribute("disabled") && isUsable(root)) root.focus();
};
